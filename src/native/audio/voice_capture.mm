#include "voice_capture.h"

#import <AudioToolbox/AudioToolbox.h>
#import <AudioUnit/AudioUnit.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreFoundation/CoreFoundation.h>

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

constexpr double kTargetSampleRate = 16000.0;
constexpr UInt32 kInputBus = 1;
constexpr UInt32 kOutputBus = 0;
constexpr size_t kRingCapacity = 16000 * 4;
constexpr size_t kDrainChunkSamples = 1600;
constexpr UInt32 kMaxFramesPerRender = 8192;

struct DeviceInfo {
  AudioDeviceID id = kAudioObjectUnknown;
  std::string uid;
  std::string name;
  std::string transportType;
  UInt32 transport = 0;
  bool isDefault = false;
  bool isPhysical = false;
};

class FloatRing {
 public:
  explicit FloatRing(size_t capacity) : data_(capacity, 0.0f) {}

  void write(const float* input, size_t count) {
    std::lock_guard<std::mutex> lock(mutex_);
    for (size_t i = 0; i < count; ++i) {
      data_[writeIndex_] = input[i];
      writeIndex_ = (writeIndex_ + 1) % data_.size();
      size_ = std::min(size_ + 1, data_.size());
    }
  }

  size_t read(float* output, size_t maxCount) {
    std::lock_guard<std::mutex> lock(mutex_);
    const size_t count = std::min(maxCount, size_);
    const size_t start = (writeIndex_ + data_.size() - size_) % data_.size();
    for (size_t i = 0; i < count; ++i) {
      output[i] = data_[(start + i) % data_.size()];
    }
    size_ -= count;
    return count;
  }

  void clear() {
    std::lock_guard<std::mutex> lock(mutex_);
    writeIndex_ = 0;
    size_ = 0;
  }

 private:
  std::vector<float> data_;
  size_t writeIndex_ = 0;
  size_t size_ = 0;
  std::mutex mutex_;
};

class VoiceCapture {
 public:
  bool start(const std::string& deviceUid, Napi::Env env, Napi::Function onData, Napi::Function onError);
  void stop();
  bool isRunning() const { return running_.load(); }
  std::vector<DeviceInfo> listDevices();

 private:
  static OSStatus RenderCallback(void* inRefCon, AudioUnitRenderActionFlags* ioActionFlags, const AudioTimeStamp* inTimeStamp, UInt32 inBusNumber, UInt32 inNumberFrames, AudioBufferList* ioData);
  static OSStatus DeviceAliveListener(AudioObjectID inObjectID, UInt32 inNumberAddresses, const AudioObjectPropertyAddress inAddresses[], void* inClientData);

  bool configureAudioUnit(const std::string& deviceUid, std::string& errorMessage);
  void handleRender(AudioUnitRenderActionFlags* flags, const AudioTimeStamp* timeStamp, UInt32 frames);
  void drainLoop();
  void reportError(const std::string& message);
  AudioDeviceID resolveDevice(const std::string& uid);
  void addDeviceListener(AudioDeviceID deviceId);
  void removeDeviceListener();

  AudioUnit unit_ = nullptr;
  AudioDeviceID deviceId_ = kAudioObjectUnknown;
  AudioStreamBasicDescription streamFormat_{};
  double downsampleFill_ = 0.0;
  float downsampleSum_ = 0.0f;
  uint32_t downsampleSampleCount_ = 0;
  FloatRing ring_{kRingCapacity};
  std::vector<float> renderScratch_;
  std::vector<float> downsampleScratch_;
  std::thread drainThread_;
  Napi::ThreadSafeFunction dataCallback_;
  Napi::ThreadSafeFunction errorCallback_;
  std::atomic<bool> running_{false};
  std::atomic<bool> stopping_{false};
};

VoiceCapture g_capture;

std::string cfStringToStd(CFStringRef value) {
  if (!value) return "";
  char buffer[512] = {0};
  if (CFStringGetCString(value, buffer, sizeof(buffer), kCFStringEncodingUTF8)) {
    return buffer;
  }
  return "";
}

std::string fourChar(UInt32 value) {
  char text[5] = {
    static_cast<char>((value >> 24) & 0xff),
    static_cast<char>((value >> 16) & 0xff),
    static_cast<char>((value >> 8) & 0xff),
    static_cast<char>(value & 0xff),
    0
  };
  return text;
}

std::string transportName(UInt32 transport) {
  switch (transport) {
    case kAudioDeviceTransportTypeBuiltIn: return "built-in";
    case kAudioDeviceTransportTypeUSB: return "usb";
    case kAudioDeviceTransportTypeBluetooth: return "bluetooth";
    case kAudioDeviceTransportTypeBluetoothLE: return "bluetooth-le";
    case kAudioDeviceTransportTypeHDMI: return "hdmi";
    case kAudioDeviceTransportTypeDisplayPort: return "display-port";
    case kAudioDeviceTransportTypeAirPlay: return "airplay";
    case kAudioDeviceTransportTypeAVB: return "avb";
    case kAudioDeviceTransportTypePCI: return "pci";
    case kAudioDeviceTransportTypeFireWire: return "firewire";
    case kAudioDeviceTransportTypeAggregate: return "aggregate";
    case kAudioDeviceTransportTypeVirtual: return "virtual";
    default: return fourChar(transport);
  }
}

bool getUInt32Property(AudioObjectID objectId, AudioObjectPropertySelector selector, AudioObjectPropertyScope scope, UInt32& value) {
  AudioObjectPropertyAddress address{selector, scope, kAudioObjectPropertyElementMain};
  UInt32 size = sizeof(value);
  return AudioObjectGetPropertyData(objectId, &address, 0, nullptr, &size, &value) == noErr;
}

std::string getStringProperty(AudioObjectID objectId, AudioObjectPropertySelector selector, AudioObjectPropertyScope scope) {
  AudioObjectPropertyAddress address{selector, scope, kAudioObjectPropertyElementMain};
  CFStringRef value = nullptr;
  UInt32 size = sizeof(value);
  if (AudioObjectGetPropertyData(objectId, &address, 0, nullptr, &size, &value) != noErr || !value) {
    return "";
  }
  std::string result = cfStringToStd(value);
  CFRelease(value);
  return result;
}

AudioDeviceID defaultInputDevice() {
  AudioDeviceID device = kAudioObjectUnknown;
  UInt32 size = sizeof(device);
  AudioObjectPropertyAddress address{kAudioHardwarePropertyDefaultInputDevice, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &size, &device) != noErr) {
    return kAudioObjectUnknown;
  }
  return device;
}

bool hasInputStreams(AudioDeviceID device) {
  AudioObjectPropertyAddress address{kAudioDevicePropertyStreams, kAudioDevicePropertyScopeInput, kAudioObjectPropertyElementMain};
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(device, &address, 0, nullptr, &size) != noErr) return false;
  return size >= sizeof(AudioStreamID);
}

std::vector<DeviceInfo> enumerateInputDevices() {
  AudioObjectPropertyAddress address{kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, nullptr, &size) != noErr) return {};

  const UInt32 count = size / sizeof(AudioDeviceID);
  std::vector<AudioDeviceID> ids(count);
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, nullptr, &size, ids.data()) != noErr) return {};

  const AudioDeviceID defaultDevice = defaultInputDevice();
  std::vector<DeviceInfo> devices;
  for (AudioDeviceID id : ids) {
    if (!hasInputStreams(id)) continue;
    UInt32 transport = 0;
    getUInt32Property(id, kAudioDevicePropertyTransportType, kAudioObjectPropertyScopeGlobal, transport);
    DeviceInfo info;
    info.id = id;
    info.uid = getStringProperty(id, kAudioDevicePropertyDeviceUID, kAudioObjectPropertyScopeGlobal);
    info.name = getStringProperty(id, kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal);
    info.transport = transport;
    info.transportType = transportName(transport);
    info.isDefault = id == defaultDevice;
    info.isPhysical = transport != kAudioDeviceTransportTypeVirtual && transport != kAudioDeviceTransportTypeAggregate;
    if (!info.uid.empty()) devices.push_back(info);
  }
  return devices;
}

AudioStreamBasicDescription makeFloatFormat(double sampleRate) {
  AudioStreamBasicDescription format{};
  format.mSampleRate = sampleRate;
  format.mFormatID = kAudioFormatLinearPCM;
  format.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked | kAudioFormatFlagIsNonInterleaved;
  format.mBytesPerPacket = sizeof(float);
  format.mFramesPerPacket = 1;
  format.mBytesPerFrame = sizeof(float);
  format.mChannelsPerFrame = 1;
  format.mBitsPerChannel = sizeof(float) * 8;
  return format;
}

bool VoiceCapture::start(const std::string& deviceUid, Napi::Env env, Napi::Function onData, Napi::Function onError) {
  if (running_.load()) return true;
  stopping_.store(false);
  ring_.clear();
  dataCallback_ = Napi::ThreadSafeFunction::New(env, onData, "vaani-audio-capture-data", 0, 1);
  errorCallback_ = Napi::ThreadSafeFunction::New(env, onError, "vaani-audio-capture-error", 0, 1);

  std::string errorMessage;
  if (!configureAudioUnit(deviceUid, errorMessage)) {
    if (unit_) {
      AudioUnitUninitialize(unit_);
      AudioComponentInstanceDispose(unit_);
      unit_ = nullptr;
    }
    deviceId_ = kAudioObjectUnknown;
    dataCallback_.Release();
    errorCallback_.Release();
    return false;
  }

  running_.store(true);
  OSStatus status = AudioOutputUnitStart(unit_);
  if (status != noErr) {
    stop();
    return false;
  }

  drainThread_ = std::thread([this]() { drainLoop(); });
  return true;
}

void VoiceCapture::stop() {
  stopping_.store(true);
  running_.store(false);
  if (unit_) {
    AudioOutputUnitStop(unit_);
  }
  if (drainThread_.joinable()) {
    drainThread_.join();
  }
  removeDeviceListener();
  if (unit_) {
    AudioUnitUninitialize(unit_);
    AudioComponentInstanceDispose(unit_);
    unit_ = nullptr;
  }
  ring_.clear();
  renderScratch_.clear();
  downsampleScratch_.clear();
  if (dataCallback_) dataCallback_.Release();
  if (errorCallback_) errorCallback_.Release();
}

std::vector<DeviceInfo> VoiceCapture::listDevices() {
  return enumerateInputDevices();
}

AudioDeviceID VoiceCapture::resolveDevice(const std::string& uid) {
  const auto devices = enumerateInputDevices();
  if (!uid.empty()) {
    for (const auto& device : devices) {
      if (device.uid == uid && device.isPhysical) return device.id;
    }
  }
  for (const auto& device : devices) {
    if (device.isDefault && device.isPhysical) return device.id;
  }
  for (const auto& device : devices) {
    if (device.isPhysical) return device.id;
  }
  return kAudioObjectUnknown;
}

bool VoiceCapture::configureAudioUnit(const std::string& deviceUid, std::string& errorMessage) {
  AudioComponentDescription desc{};
  desc.componentType = kAudioUnitType_Output;
  desc.componentSubType = kAudioUnitSubType_VoiceProcessingIO;
  desc.componentManufacturer = kAudioUnitManufacturer_Apple;

  AudioComponent component = AudioComponentFindNext(nullptr, &desc);
  if (!component) {
    errorMessage = "VoiceProcessingIO AudioUnit is unavailable.";
    return false;
  }
  if (AudioComponentInstanceNew(component, &unit_) != noErr || !unit_) {
    errorMessage = "Could not create VoiceProcessingIO AudioUnit.";
    return false;
  }

  UInt32 enable = 1;
  UInt32 disable = 0;
  AudioUnitSetProperty(unit_, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, kInputBus, &enable, sizeof(enable));
  AudioUnitSetProperty(unit_, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output, kOutputBus, &disable, sizeof(disable));

  UInt32 bypass = 0;
  AudioUnitSetProperty(unit_, kAUVoiceIOProperty_BypassVoiceProcessing, kAudioUnitScope_Global, kInputBus, &bypass, sizeof(bypass));
  // Apple AGC reshapes phonemes enough to hurt Whisper accuracy; keep it off.
  // Quiet clips are peak-normalized in JS before hitting STT instead.
  UInt32 agc = 0;
  AudioUnitSetProperty(unit_, kAUVoiceIOProperty_VoiceProcessingEnableAGC, kAudioUnitScope_Global, kInputBus, &agc, sizeof(agc));

  // Voice processing ducks other apps' audio system-wide while the unit runs;
  // with warm capture that would lower background audio the whole time the
  // app is open. Opt out where the OS allows it (macOS 14+).
#if defined(MAC_OS_VERSION_14_0) && MAC_OS_X_VERSION_MAX_ALLOWED >= MAC_OS_VERSION_14_0
  if (@available(macOS 14.0, *)) {
    AUVoiceIOOtherAudioDuckingConfiguration ducking{};
    ducking.mEnableAdvancedDucking = false;
    ducking.mDuckingLevel = kAUVoiceIOOtherAudioDuckingLevelMin;
    AudioUnitSetProperty(unit_, kAUVoiceIOProperty_OtherAudioDuckingConfiguration, kAudioUnitScope_Global, 0, &ducking, sizeof(ducking));
  }
#endif

  deviceId_ = resolveDevice(deviceUid);
  if (deviceId_ == kAudioObjectUnknown) {
    errorMessage = "No physical microphone found.";
    return false;
  }
  AudioUnitSetProperty(unit_, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &deviceId_, sizeof(deviceId_));

  streamFormat_ = makeFloatFormat(kTargetSampleRate);
  OSStatus formatStatus = AudioUnitSetProperty(unit_, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, kInputBus, &streamFormat_, sizeof(streamFormat_));
  if (formatStatus != noErr) {
    UInt32 size = sizeof(streamFormat_);
    if (AudioUnitGetProperty(unit_, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, kInputBus, &streamFormat_, &size) != noErr) {
      Float64 nominalRate = kTargetSampleRate;
      UInt32 rateSize = sizeof(nominalRate);
      AudioObjectPropertyAddress rateAddress{kAudioDevicePropertyNominalSampleRate, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
      AudioObjectGetPropertyData(deviceId_, &rateAddress, 0, nullptr, &rateSize, &nominalRate);
      streamFormat_ = makeFloatFormat(nominalRate);
      AudioUnitSetProperty(unit_, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, kInputBus, &streamFormat_, sizeof(streamFormat_));
    }
  }

  AURenderCallbackStruct callback{};
  callback.inputProc = VoiceCapture::RenderCallback;
  callback.inputProcRefCon = this;
  AudioUnitSetProperty(unit_, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, kInputBus, &callback, sizeof(callback));

  renderScratch_.assign(kMaxFramesPerRender, 0.0f);
  downsampleScratch_.assign(kMaxFramesPerRender, 0.0f);
  downsampleFill_ = 0.0;
  downsampleSum_ = 0.0f;
  downsampleSampleCount_ = 0;

  OSStatus initStatus = AudioUnitInitialize(unit_);
  if (initStatus != noErr) {
    errorMessage = "Could not initialize microphone capture.";
    return false;
  }
  addDeviceListener(deviceId_);
  return true;
}

OSStatus VoiceCapture::RenderCallback(void* inRefCon, AudioUnitRenderActionFlags* ioActionFlags, const AudioTimeStamp* inTimeStamp, UInt32, UInt32 inNumberFrames, AudioBufferList*) {
  auto* self = static_cast<VoiceCapture*>(inRefCon);
  if (!self || !self->running_.load()) return noErr;
  self->handleRender(ioActionFlags, inTimeStamp, inNumberFrames);
  return noErr;
}

void VoiceCapture::handleRender(AudioUnitRenderActionFlags* flags, const AudioTimeStamp* timeStamp, UInt32 frames) {
  if (!unit_ || frames == 0) return;
  const UInt32 clampedFrames = std::min(frames, kMaxFramesPerRender);
  AudioBufferList bufferList{};
  bufferList.mNumberBuffers = 1;
  bufferList.mBuffers[0].mNumberChannels = 1;
  bufferList.mBuffers[0].mDataByteSize = clampedFrames * sizeof(float);
  bufferList.mBuffers[0].mData = renderScratch_.data();
  OSStatus status = AudioUnitRender(unit_, flags, timeStamp, kInputBus, clampedFrames, &bufferList);
  if (status != noErr) return;

  // The unit reports how much it actually rendered; trusting the requested
  // frame count would push stale scratch samples into the ring.
  const size_t renderedFrames = std::min<size_t>(clampedFrames, bufferList.mBuffers[0].mDataByteSize / sizeof(float));
  if (renderedFrames == 0) return;

  const double inputRate = streamFormat_.mSampleRate > 0 ? streamFormat_.mSampleRate : kTargetSampleRate;
  if (std::abs(inputRate - kTargetSampleRate) < 1.0) {
    ring_.write(renderScratch_.data(), renderedFrames);
    return;
  }

  // Phase-continuous box downsample: the fractional window fill carries across
  // callbacks so the output rate has no cumulative drift.
  const double ratio = inputRate / kTargetSampleRate;
  size_t outputCount = 0;
  for (size_t source = 0; source < renderedFrames && outputCount < downsampleScratch_.size(); ++source) {
    downsampleSum_ += renderScratch_[source];
    downsampleSampleCount_ += 1;
    downsampleFill_ += 1.0;
    if (downsampleFill_ >= ratio) {
      downsampleScratch_[outputCount++] = downsampleSum_ / static_cast<float>(downsampleSampleCount_);
      downsampleSum_ = 0.0f;
      downsampleSampleCount_ = 0;
      downsampleFill_ -= ratio;
    }
  }
  if (outputCount > 0) ring_.write(downsampleScratch_.data(), outputCount);
}

void VoiceCapture::drainLoop() {
  std::vector<float> chunk(kDrainChunkSamples);
  while (!stopping_.load()) {
    const size_t count = ring_.read(chunk.data(), chunk.size());
    if (count > 0 && dataCallback_) {
      auto payload = new std::vector<float>(chunk.begin(), chunk.begin() + static_cast<std::ptrdiff_t>(count));
      dataCallback_.NonBlockingCall(payload, [](Napi::Env env, Napi::Function callback, std::vector<float>* data) {
        Napi::ArrayBuffer arrayBuffer = Napi::ArrayBuffer::New(env, data->size() * sizeof(float));
        std::memcpy(arrayBuffer.Data(), data->data(), data->size() * sizeof(float));
        Napi::Float32Array array = Napi::Float32Array::New(env, data->size(), arrayBuffer, 0);
        callback.Call({array});
        delete data;
      });
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }
}

void VoiceCapture::reportError(const std::string& message) {
  if (!errorCallback_) return;
  auto* payload = new std::string(message);
  errorCallback_.NonBlockingCall(payload, [](Napi::Env env, Napi::Function callback, std::string* data) {
    callback.Call({Napi::String::New(env, *data)});
    delete data;
  });
}

void VoiceCapture::addDeviceListener(AudioDeviceID deviceId) {
  AudioObjectPropertyAddress address{kAudioDevicePropertyDeviceIsAlive, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
  AudioObjectAddPropertyListener(deviceId, &address, VoiceCapture::DeviceAliveListener, this);
}

void VoiceCapture::removeDeviceListener() {
  if (deviceId_ == kAudioObjectUnknown) return;
  AudioObjectPropertyAddress address{kAudioDevicePropertyDeviceIsAlive, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
  AudioObjectRemovePropertyListener(deviceId_, &address, VoiceCapture::DeviceAliveListener, this);
  deviceId_ = kAudioObjectUnknown;
}

OSStatus VoiceCapture::DeviceAliveListener(AudioObjectID, UInt32, const AudioObjectPropertyAddress[], void* inClientData) {
  auto* self = static_cast<VoiceCapture*>(inClientData);
  if (!self || self->stopping_.load()) return noErr;
  UInt32 alive = 1;
  if (!getUInt32Property(self->deviceId_, kAudioDevicePropertyDeviceIsAlive, kAudioObjectPropertyScopeGlobal, alive) || alive == 0) {
    self->reportError("Microphone input stopped. Check your selected microphone.");
  }
  return noErr;
}

Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "Expected options object").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }
  Napi::Object options = info[0].As<Napi::Object>();
  if (!options.Get("onData").IsFunction() || !options.Get("onError").IsFunction()) {
    Napi::TypeError::New(env, "Expected onData and onError callbacks").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }
  std::string deviceUid;
  if (options.Has("deviceUid") && options.Get("deviceUid").IsString()) {
    deviceUid = options.Get("deviceUid").As<Napi::String>().Utf8Value();
  }
  const bool ok = g_capture.start(
    deviceUid,
    env,
    options.Get("onData").As<Napi::Function>(),
    options.Get("onError").As<Napi::Function>()
  );
  return Napi::Boolean::New(env, ok);
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  g_capture.stop();
  return info.Env().Undefined();
}

Napi::Value IsRunning(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), g_capture.isRunning());
}

Napi::Value ListInputDevices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  const auto devices = g_capture.listDevices();
  Napi::Array output = Napi::Array::New(env, devices.size());
  for (size_t i = 0; i < devices.size(); ++i) {
    Napi::Object item = Napi::Object::New(env);
    item.Set("uid", Napi::String::New(env, devices[i].uid));
    item.Set("name", Napi::String::New(env, devices[i].name));
    item.Set("transportType", Napi::String::New(env, devices[i].transportType));
    item.Set("isDefault", Napi::Boolean::New(env, devices[i].isDefault));
    item.Set("isPhysical", Napi::Boolean::New(env, devices[i].isPhysical));
    output[i] = item;
  }
  return output;
}

} // namespace

Napi::Object InitVoiceCapture(Napi::Env env, Napi::Object exports) {
  exports.Set("audioCaptureStart", Napi::Function::New(env, Start));
  exports.Set("audioCaptureStop", Napi::Function::New(env, Stop));
  exports.Set("audioCaptureIsRunning", Napi::Function::New(env, IsRunning));
  exports.Set("audioCaptureListInputDevices", Napi::Function::New(env, ListInputDevices));
  return exports;
}
