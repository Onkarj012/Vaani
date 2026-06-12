#include <napi.h>
#include <atomic>
#include <vector>
#include <unistd.h>
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#import <CoreAudio/CoreAudio.h>

namespace {
constexpr AXValueType kRangeType = static_cast<AXValueType>(kAXValueCFRangeType);

// macOS caches AXIsProcessTrusted() per-process, so a poll keeps seeing the
// stale value the process saw at launch — the user grants Accessibility but the
// app still reports "not granted" until restart. Observing the system
// "com.apple.accessibility.api" notification and re-querying after a short delay
// is the documented way to pick up the change live.
std::atomic<bool> g_axTrusted{false};
std::atomic<bool> g_axObserverInstalled{false};

void EnsureAxTrustObserver() {
  if (g_axObserverInstalled.exchange(true)) {
    return;
  }
  g_axTrusted.store(AXIsProcessTrusted());
  [[NSDistributedNotificationCenter defaultCenter]
      addObserverForName:@"com.apple.accessibility.api"
                  object:nil
                   queue:[NSOperationQueue mainQueue]
              usingBlock:^(NSNotification*) {
                // Querying immediately returns the old cached value; a small
                // delay lets the run loop flush it before we re-read.
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(250 * NSEC_PER_MSEC)),
                               dispatch_get_main_queue(), ^{
                                 g_axTrusted.store(AXIsProcessTrusted());
                               });
              }];
}

Napi::Object SuccessResult(Napi::Env env) {
  Napi::Object result = Napi::Object::New(env);
  result.Set("success", Napi::Boolean::New(env, true));
  return result;
}

Napi::Object FailureResult(Napi::Env env, const char* reason) {
  Napi::Object result = Napi::Object::New(env);
  result.Set("success", Napi::Boolean::New(env, false));
  result.Set("reason", Napi::String::New(env, reason));
  return result;
}

void PostKeyboardEvent(CGEventRef event) {
  if (event == nullptr) {
    return;
  }

  CGEventPost(kCGHIDEventTap, event);
}

bool IsEditableFailure(AXError error) {
  return error == kAXErrorAttributeUnsupported || error == kAXErrorNoValue || error == kAXErrorCannotComplete;
}

AXUIElementRef CopyFocusedElement() {
  AXUIElementRef systemWideElement = AXUIElementCreateSystemWide();
  if (systemWideElement == nullptr) {
    return nullptr;
  }

  CFTypeRef focusedElement = nullptr;
  AXError focusedResult =
      AXUIElementCopyAttributeValue(systemWideElement, kAXFocusedUIElementAttribute, &focusedElement);
  CFRelease(systemWideElement);

  if (focusedResult != kAXErrorSuccess || focusedElement == nullptr) {
    if (focusedElement != nullptr) {
      CFRelease(focusedElement);
    }
    return nullptr;
  }

  return static_cast<AXUIElementRef>(focusedElement);
}

bool CopySelectedRange(AXUIElementRef element, CFRange* selectedRange) {
  if (element == nullptr || selectedRange == nullptr) {
    return false;
  }

  CFTypeRef selectedRangeValue = nullptr;
  AXError rangeResult = AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute, &selectedRangeValue);
  if (rangeResult != kAXErrorSuccess || selectedRangeValue == nullptr || CFGetTypeID(selectedRangeValue) != AXValueGetTypeID()) {
    if (selectedRangeValue != nullptr) {
      CFRelease(selectedRangeValue);
    }
    return false;
  }

  AXValueRef axRange = static_cast<AXValueRef>(selectedRangeValue);
  bool success = AXValueGetType(axRange) == kRangeType && AXValueGetValue(axRange, kRangeType, selectedRange);
  CFRelease(selectedRangeValue);
  return success;
}

bool SetSelectedRange(AXUIElementRef element, CFRange selectedRange) {
  if (element == nullptr) {
    return false;
  }

  AXValueRef rangeValue = AXValueCreate(kRangeType, &selectedRange);
  if (rangeValue == nullptr) {
    return false;
  }

  AXError result = AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute, rangeValue);
  CFRelease(rangeValue);
  return result == kAXErrorSuccess;
}

bool ReplaceSelectedRange(AXUIElementRef element, NSString* text) {
  CFTypeRef currentValue = nullptr;
  AXError valueResult = AXUIElementCopyAttributeValue(element, kAXValueAttribute, &currentValue);
  if (valueResult != kAXErrorSuccess || currentValue == nullptr || CFGetTypeID(currentValue) != CFStringGetTypeID()) {
    if (currentValue != nullptr) {
      CFRelease(currentValue);
    }
    return false;
  }

  CFRange selectedRange;
  if (!CopySelectedRange(element, &selectedRange)) {
    CFRelease(currentValue);
    return false;
  }

  NSString* existingText = (__bridge NSString*)currentValue;
  NSRange currentRange = NSMakeRange(0, [existingText length]);

  // Handle hint/placeholder text: check if field value matches placeholder attribute.
  // When a field shows hint text as its actual value, treat the field as empty
  // so the transcription replaces the hint instead of being prepended to it.
  CFTypeRef placeholderValue = nullptr;
  AXError placeholderResult = AXUIElementCopyAttributeValue(element, kAXPlaceholderValueAttribute, &placeholderValue);
  if (placeholderResult == kAXErrorSuccess && placeholderValue != nullptr && CFGetTypeID(placeholderValue) == CFStringGetTypeID()) {
    NSString* placeholder = (__bridge NSString*)placeholderValue;
    if ([existingText isEqualToString:placeholder] || [existingText hasPrefix:placeholder]) {
      // Field value is placeholder text — treat as empty, replace full value
      AXError setValueResult = AXUIElementSetAttributeValue(element, kAXValueAttribute, (__bridge CFTypeRef)text);
      CFRelease(placeholderValue);
      CFRelease(currentValue);
      if (setValueResult == kAXErrorSuccess) {
        CFRange caretRange;
        caretRange.location = [text length];
        caretRange.length = 0;
        SetSelectedRange(element, caretRange);
        return true;
      }
      return false;
    }
  }
  if (placeholderValue != nullptr) {
    CFRelease(placeholderValue);
  }

  NSRange safeRange = NSIntersectionRange(
      NSMakeRange(MAX(0, selectedRange.location), MAX(0, selectedRange.length)),
      currentRange);
  NSString* updatedText = [existingText stringByReplacingCharactersInRange:safeRange withString:text];
  AXError setValueResult = AXUIElementSetAttributeValue(element, kAXValueAttribute, (__bridge CFTypeRef)updatedText);
  if (setValueResult != kAXErrorSuccess) {
    CFRelease(currentValue);
    return false;
  }

  CFRange caretRange;
  caretRange.location = safeRange.location + [text length];
  caretRange.length = 0;
  SetSelectedRange(element, caretRange);
  CFRelease(currentValue);
  return true;
}

AudioDeviceID CopyDefaultInputDeviceID() {
  AudioDeviceID deviceID = kAudioObjectUnknown;
  UInt32 dataSize = sizeof(deviceID);
  AudioObjectPropertyAddress address = {
      kAudioHardwarePropertyDefaultInputDevice,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain};

  OSStatus status =
      AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nullptr, &dataSize, &deviceID);
  if (status != noErr) {
    return kAudioObjectUnknown;
  }

  return deviceID;
}

bool SetDefaultInputDeviceID(AudioDeviceID deviceID) {
  if (deviceID == kAudioObjectUnknown) {
    return false;
  }

  UInt32 dataSize = sizeof(deviceID);
  AudioObjectPropertyAddress address = {
      kAudioHardwarePropertyDefaultInputDevice,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain};

  OSStatus status = AudioObjectSetPropertyData(
      AudioObjectID(kAudioObjectSystemObject), &address, 0, nullptr, dataSize, &deviceID);
  return status == noErr;
}

AudioDeviceID FindBuiltInInputDeviceID() {
  AudioObjectPropertyAddress devicesAddress = {
      kAudioHardwarePropertyDevices,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain};

  UInt32 dataSize = 0;
  if (AudioObjectGetPropertyDataSize(
          AudioObjectID(kAudioObjectSystemObject), &devicesAddress, 0, nullptr, &dataSize) != noErr) {
    return kAudioObjectUnknown;
  }

  UInt32 deviceCount = dataSize / sizeof(AudioDeviceID);
  if (deviceCount == 0) {
    return kAudioObjectUnknown;
  }

  std::vector<AudioDeviceID> devices(deviceCount, kAudioObjectUnknown);
  if (AudioObjectGetPropertyData(
          AudioObjectID(kAudioObjectSystemObject), &devicesAddress, 0, nullptr, &dataSize, devices.data()) != noErr) {
    return kAudioObjectUnknown;
  }

  for (AudioDeviceID device : devices) {
    UInt32 transportType = 0;
    UInt32 transportSize = sizeof(transportType);
    AudioObjectPropertyAddress transportAddress = {
        kAudioDevicePropertyTransportType,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain};
    if (AudioObjectGetPropertyData(device, &transportAddress, 0, nullptr, &transportSize, &transportType) != noErr) {
      continue;
    }

    if (transportType != kAudioDeviceTransportTypeBuiltIn) {
      continue;
    }

    AudioObjectPropertyAddress inputAddress = {
        kAudioDevicePropertyStreamConfiguration,
        kAudioDevicePropertyScopeInput,
        kAudioObjectPropertyElementMain};

    UInt32 inputSize = 0;
    if (AudioObjectGetPropertyDataSize(device, &inputAddress, 0, nullptr, &inputSize) != noErr || inputSize == 0) {
      continue;
    }

    AudioBufferList* bufferList = static_cast<AudioBufferList*>(malloc(inputSize));
    if (bufferList == nullptr) {
      continue;
    }

    bool hasInput = false;
    if (AudioObjectGetPropertyData(device, &inputAddress, 0, nullptr, &inputSize, bufferList) == noErr) {
      for (UInt32 index = 0; index < bufferList->mNumberBuffers; index += 1) {
        if (bufferList->mBuffers[index].mNumberChannels > 0) {
          hasInput = true;
          break;
        }
      }
    }
    free(bufferList);

    if (hasInput) {
      return device;
    }
  }

  return kAudioObjectUnknown;
}
}

Napi::Boolean IsAccessibilityTrusted(const Napi::CallbackInfo& info) {
  EnsureAxTrustObserver();
  // A direct read returning true is always reliable; a false read may be the
  // stale per-process cache, so fall back to the observer-maintained value.
  if (AXIsProcessTrusted()) {
    g_axTrusted.store(true);
  }
  return Napi::Boolean::New(info.Env(), g_axTrusted.load());
}

Napi::Object InjectText(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected text input").ThrowAsJavaScriptException();
    return FailureResult(env, "insertion_failed");
  }

  if (!AXIsProcessTrusted()) {
    return FailureResult(env, "permission_missing");
  }

  AXUIElementRef focusedElement = CopyFocusedElement();
  if (focusedElement == nullptr) {
    return FailureResult(env, "no_editable_target");
  }

  NSString* text = [NSString stringWithUTF8String:info[0].As<Napi::String>().Utf8Value().c_str()];
  if (ReplaceSelectedRange(focusedElement, text)) {
    CFRelease(focusedElement);
    return SuccessResult(env);
  }

  AXError selectedResult =
      AXUIElementSetAttributeValue(focusedElement, kAXSelectedTextAttribute, (__bridge CFTypeRef)text);
  if (selectedResult == kAXErrorSuccess) {
    CFRelease(focusedElement);
    return SuccessResult(env);
  }

  CFRelease(focusedElement);

  if (IsEditableFailure(selectedResult)) {
    return FailureResult(env, "no_editable_target");
  }

  return FailureResult(env, "insertion_failed");
}

Napi::Value GetFocusedSelection(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!AXIsProcessTrusted()) {
    return env.Null();
  }

  AXUIElementRef focusedElement = CopyFocusedElement();
  if (focusedElement == nullptr) {
    return env.Null();
  }

  CFRange selectedRange;
  bool success = CopySelectedRange(focusedElement, &selectedRange);
  CFRelease(focusedElement);
  if (!success) {
    return env.Null();
  }

  Napi::Object result = Napi::Object::New(env);
  result.Set("location", Napi::Number::New(env, selectedRange.location));
  result.Set("length", Napi::Number::New(env, selectedRange.length));
  return result;
}

Napi::Value GetFocusedValue(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!AXIsProcessTrusted()) {
    return env.Null();
  }

  AXUIElementRef focusedElement = CopyFocusedElement();
  if (focusedElement == nullptr) {
    return env.Null();
  }

  CFTypeRef currentValue = nullptr;
  AXError valueResult = AXUIElementCopyAttributeValue(focusedElement, kAXValueAttribute, &currentValue);
  CFRelease(focusedElement);
  if (valueResult != kAXErrorSuccess || currentValue == nullptr || CFGetTypeID(currentValue) != CFStringGetTypeID()) {
    if (currentValue != nullptr) {
      CFRelease(currentValue);
    }
    return env.Null();
  }

  NSString* text = (__bridge NSString*)currentValue;
  Napi::String result = Napi::String::New(env, [text UTF8String]);
  CFRelease(currentValue);
  return result;
}

Napi::Boolean SetFocusedSelection(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Expected location and length").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  if (!AXIsProcessTrusted()) {
    return Napi::Boolean::New(env, false);
  }

  AXUIElementRef focusedElement = CopyFocusedElement();
  if (focusedElement == nullptr) {
    return Napi::Boolean::New(env, false);
  }

  int64_t locationInput = info[0].As<Napi::Number>().Int64Value();
  int64_t lengthInput = info[1].As<Napi::Number>().Int64Value();
  CFRange selectedRange;
  selectedRange.location = locationInput < 0 ? 0 : static_cast<CFIndex>(locationInput);
  selectedRange.length = lengthInput < 0 ? 0 : static_cast<CFIndex>(lengthInput);

  bool success = SetSelectedRange(focusedElement, selectedRange);
  CFRelease(focusedElement);
  return Napi::Boolean::New(env, success);
}

Napi::Boolean PasteText(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected text input").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  NSPasteboard* pasteboard = [NSPasteboard generalPasteboard];
  [pasteboard clearContents];
  NSString* text = [NSString stringWithUTF8String:info[0].As<Napi::String>().Utf8Value().c_str()];
  [pasteboard setString:text forType:NSPasteboardTypeString];

  CGEventRef optionUp = CGEventCreateKeyboardEvent(nullptr, kVK_Option, false);
  CGEventRef controlUp = CGEventCreateKeyboardEvent(nullptr, kVK_Control, false);
  CGEventRef shiftUp = CGEventCreateKeyboardEvent(nullptr, kVK_Shift, false);
  CGEventRef rightOptionUp = CGEventCreateKeyboardEvent(nullptr, kVK_RightOption, false);
  CGEventRef rightControlUp = CGEventCreateKeyboardEvent(nullptr, kVK_RightControl, false);
  CGEventRef rightShiftUp = CGEventCreateKeyboardEvent(nullptr, kVK_RightShift, false);
  CGEventRef rightCommandUp = CGEventCreateKeyboardEvent(nullptr, kVK_RightCommand, false);

  CGEventRef commandDown = CGEventCreateKeyboardEvent(nullptr, kVK_Command, true);
  CGEventRef vDown = CGEventCreateKeyboardEvent(nullptr, kVK_ANSI_V, true);
  CGEventRef vUp = CGEventCreateKeyboardEvent(nullptr, kVK_ANSI_V, false);
  CGEventRef commandUp = CGEventCreateKeyboardEvent(nullptr, kVK_Command, false);

  CGEventSetFlags(vDown, kCGEventFlagMaskCommand);
  CGEventSetFlags(vUp, kCGEventFlagMaskCommand);

  PostKeyboardEvent(optionUp);
  PostKeyboardEvent(controlUp);
  PostKeyboardEvent(shiftUp);
  PostKeyboardEvent(rightOptionUp);
  PostKeyboardEvent(rightControlUp);
  PostKeyboardEvent(rightShiftUp);
  PostKeyboardEvent(rightCommandUp);
  usleep(15000);
  PostKeyboardEvent(commandDown);
  usleep(10000);
  PostKeyboardEvent(vDown);
  usleep(10000);
  PostKeyboardEvent(vUp);
  usleep(10000);
  PostKeyboardEvent(commandUp);

  CFRelease(optionUp);
  CFRelease(controlUp);
  CFRelease(shiftUp);
  CFRelease(rightOptionUp);
  CFRelease(rightControlUp);
  CFRelease(rightShiftUp);
  CFRelease(rightCommandUp);
  CFRelease(commandDown);
  CFRelease(vDown);
  CFRelease(vUp);
  CFRelease(commandUp);

  return Napi::Boolean::New(env, true);
}

Napi::Boolean TypeText(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected text input").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  NSString* text = [NSString stringWithUTF8String:info[0].As<Napi::String>().Utf8Value().c_str()];
  if (text == nil) {
    return Napi::Boolean::New(env, false);
  }

  CGEventRef optionUp = CGEventCreateKeyboardEvent(nullptr, kVK_Option, false);
  CGEventRef controlUp = CGEventCreateKeyboardEvent(nullptr, kVK_Control, false);
  CGEventRef shiftUp = CGEventCreateKeyboardEvent(nullptr, kVK_Shift, false);
  CGEventRef rightOptionUp = CGEventCreateKeyboardEvent(nullptr, kVK_RightOption, false);
  CGEventRef rightControlUp = CGEventCreateKeyboardEvent(nullptr, kVK_RightControl, false);
  CGEventRef rightShiftUp = CGEventCreateKeyboardEvent(nullptr, kVK_RightShift, false);
  CGEventRef rightCommandUp = CGEventCreateKeyboardEvent(nullptr, kVK_RightCommand, false);

  PostKeyboardEvent(optionUp);
  PostKeyboardEvent(controlUp);
  PostKeyboardEvent(shiftUp);
  PostKeyboardEvent(rightOptionUp);
  PostKeyboardEvent(rightControlUp);
  PostKeyboardEvent(rightShiftUp);
  PostKeyboardEvent(rightCommandUp);
  usleep(15000);

  for (NSUInteger index = 0; index < [text length]; index++) {
    UniChar character = [text characterAtIndex:index];
    CGEventRef keyDown = CGEventCreateKeyboardEvent(nullptr, 0, true);
    CGEventRef keyUp = CGEventCreateKeyboardEvent(nullptr, 0, false);
    if (keyDown == nullptr || keyUp == nullptr) {
      if (keyDown != nullptr) {
        CFRelease(keyDown);
      }
      if (keyUp != nullptr) {
        CFRelease(keyUp);
      }
      continue;
    }

    CGEventKeyboardSetUnicodeString(keyDown, 1, &character);
    CGEventKeyboardSetUnicodeString(keyUp, 1, &character);
    PostKeyboardEvent(keyDown);
    usleep(8000);
    PostKeyboardEvent(keyUp);
    usleep(character == '\n' ? 12000 : 6000);
    CFRelease(keyDown);
    CFRelease(keyUp);
  }

  CFRelease(optionUp);
  CFRelease(controlUp);
  CFRelease(shiftUp);
  CFRelease(rightOptionUp);
  CFRelease(rightControlUp);
  CFRelease(rightShiftUp);
  CFRelease(rightCommandUp);

  return Napi::Boolean::New(env, true);
}

Napi::Value PrepareRecordingInput(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  AudioDeviceID currentDevice = CopyDefaultInputDeviceID();
  AudioDeviceID builtInDevice = FindBuiltInInputDeviceID();
  if (currentDevice == kAudioObjectUnknown || builtInDevice == kAudioObjectUnknown || currentDevice == builtInDevice) {
    return env.Null();
  }

  // Only switch to built-in mic for Bluetooth devices. Bluetooth SCO forces
  // both input and output to 8–16 kHz when the mic is active, so switching to
  // the built-in mic keeps the headphone output in high-quality A2DP mode.
  // For wired/USB audio adapters, switching the system-wide default input
  // broadcasts a CoreAudio notification that can cause media players to
  // re-route their output back to the built-in speakers, making the mic pick
  // up the speaker audio — which is exactly the background-noise bug.
  UInt32 transportType = 0;
  UInt32 transportSize = sizeof(transportType);
  AudioObjectPropertyAddress transportAddress = {
      kAudioDevicePropertyTransportType,
      kAudioObjectPropertyScopeGlobal,
      kAudioObjectPropertyElementMain};
  if (AudioObjectGetPropertyData(currentDevice, &transportAddress, 0, nullptr, &transportSize, &transportType) != noErr) {
    return env.Null();
  }
  bool isBluetooth = (transportType == kAudioDeviceTransportTypeBluetooth ||
                      transportType == kAudioDeviceTransportTypeBluetoothLE);
  if (!isBluetooth) {
    return env.Null();
  }

  if (!SetDefaultInputDeviceID(builtInDevice)) {
    return env.Null();
  }

  return Napi::Number::New(env, currentDevice);
}

Napi::Boolean RestoreRecordingInput(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    return Napi::Boolean::New(env, false);
  }

  uint32_t deviceID = info[0].As<Napi::Number>().Uint32Value();
  return Napi::Boolean::New(env, SetDefaultInputDeviceID(deviceID));
}

Napi::Object InitAccessibility(Napi::Env env, Napi::Object exports) {
  exports.Set("isAccessibilityTrusted", Napi::Function::New(env, IsAccessibilityTrusted));
  exports.Set("injectText", Napi::Function::New(env, InjectText));
  exports.Set("pasteText", Napi::Function::New(env, PasteText));
  exports.Set("typeText", Napi::Function::New(env, TypeText));
  exports.Set("getFocusedSelection", Napi::Function::New(env, GetFocusedSelection));
  exports.Set("getFocusedValue", Napi::Function::New(env, GetFocusedValue));
  exports.Set("setFocusedSelection", Napi::Function::New(env, SetFocusedSelection));
  exports.Set("prepareRecordingInput", Napi::Function::New(env, PrepareRecordingInput));
  exports.Set("restoreRecordingInput", Napi::Function::New(env, RestoreRecordingInput));
  return exports;
}

Napi::Object InitDetector(Napi::Env env, Napi::Object exports);
Napi::Object InitHotkeyMonitor(Napi::Env env, Napi::Object exports);
Napi::Object InitWhisper(Napi::Env env, Napi::Object exports);

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  InitAccessibility(env, exports);
  InitDetector(env, exports);
  InitHotkeyMonitor(env, exports);
  InitWhisper(env, exports);
  return exports;
}

NODE_API_MODULE(vaani_native, InitAll)
