#include "whisper_engine.h"
#include <napi.h>

namespace {

Napi::Value LoadModel(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected model path string").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();
  bool result = vaani::whisper::WhisperLoadModel(path.c_str());
  return Napi::Boolean::New(env, result);
}

Napi::Value Transcribe(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "Expected (Float32Array, sampleRate)").ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::TypedArray typed = info[0].As<Napi::TypedArray>();
  if (typed.TypedArrayType() != napi_float32_array) {
    Napi::TypeError::New(env, "Expected Float32Array for pcm").ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Float32Array pcmArray = info[0].As<Napi::Float32Array>();
  int sampleRate = info[1].As<Napi::Number>().Int32Value();

  char output[4096] = {0};
  bool ok = vaani::whisper::WhisperTranscribe(
    pcmArray.Data(),
    pcmArray.ElementLength(),
    sampleRate,
    output,
    sizeof(output) - 1
  );

  return Napi::String::New(env, ok ? output : "");
}

Napi::Value IsModelLoaded(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), vaani::whisper::WhisperIsModelLoaded());
}

Napi::Value FreeModel(const Napi::CallbackInfo& info) {
  vaani::whisper::WhisperFreeModel();
  return info.Env().Undefined();
}

Napi::Value ListModels(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    return Napi::Array::New(env, 0);
  }
  std::string dir = info[0].As<Napi::String>().Utf8Value();
  auto models = vaani::whisper::WhisperListModels(dir.c_str());
  Napi::Array result = Napi::Array::New(env, models.size());
  for (size_t i = 0; i < models.size(); i++) {
    result[i] = Napi::String::New(env, models[i]);
  }
  return result;
}

} // anonymous namespace

Napi::Object InitWhisper(Napi::Env env, Napi::Object exports) {
  exports.Set("whisperLoadModel", Napi::Function::New(env, LoadModel));
  exports.Set("whisperTranscribe", Napi::Function::New(env, Transcribe));
  exports.Set("whisperIsModelLoaded", Napi::Function::New(env, IsModelLoaded));
  exports.Set("whisperFreeModel", Napi::Function::New(env, FreeModel));
  exports.Set("whisperListModels", Napi::Function::New(env, ListModels));
  return exports;
}
