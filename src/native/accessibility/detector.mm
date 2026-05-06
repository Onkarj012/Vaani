#include <napi.h>
#import <AppKit/AppKit.h>

Napi::Object GetFrontmostApplication(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object result = Napi::Object::New(env);

  NSRunningApplication* app = [[NSWorkspace sharedWorkspace] frontmostApplication];
  if (app != nil) {
    result.Set("bundleId", Napi::String::New(env, [[app bundleIdentifier] UTF8String] ?: ""));
    result.Set("name", Napi::String::New(env, [[app localizedName] UTF8String] ?: ""));
  }

  return result;
}

Napi::Object InitDetector(Napi::Env env, Napi::Object exports) {
  exports.Set("getFrontmostApplication", Napi::Function::New(env, GetFrontmostApplication));
  return exports;
}
