#include <napi.h>
#include <climits>
#include <chrono>
#include <pthread.h>
#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>
#import <CoreGraphics/CoreGraphics.h>

namespace {

// MARK: - State

bool isHotkeyPressed = false;
bool watchesFunctionModifier = false;
unsigned short monitoredKeyCode = USHRT_MAX;
CGEventFlags monitoredModifiers = 0;
Napi::ThreadSafeFunction hotkeyCallback;

bool isPasteLatestPressed = false;
bool pasteLatestWatchesFunctionModifier = false;
unsigned short pasteLatestKeyCode = USHRT_MAX;
CGEventFlags pasteLatestModifiers = 0;
Napi::ThreadSafeFunction pasteLatestCallback;

// Fn key state tracking (CGEvent doesn't expose Fn as a modifier flag)
bool isFnKeyPressed = false;

const int64_t MIN_HOLD_MS = 300;
int64_t keyDownTime = 0;
bool pendingUp = false;
dispatch_source_t upTimer = nil;

// CGEventTap state
CFMachPortRef primaryEventTap = nullptr;
CFRunLoopSourceRef primaryRunLoopSource = nullptr;
pthread_t eventTapThread = 0;
bool eventTapRunning = false;
CFRunLoopRef eventTapRunLoop = nullptr;  // Store reference to the actual run loop

// MARK: - Time Utilities

int64_t CurrentTimeMs() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
    std::chrono::steady_clock::now().time_since_epoch()).count();
}

// MARK: - Callback Emission

void EmitHotkeyState(bool isPressed) {
  if (!hotkeyCallback) {
    return;
  }

  auto* state = new bool(isPressed);
  hotkeyCallback.BlockingCall(state, [](Napi::Env env, Napi::Function callback, bool* value) {
    callback.Call({Napi::Boolean::New(env, *value)});
    delete value;
  });
}

void EmitPasteLatest() {
  if (!pasteLatestCallback) {
    return;
  }

  pasteLatestCallback.BlockingCall([](Napi::Env env, Napi::Function callback) {
    callback.Call({});
  });
}

// MARK: - Delayed Release

void CancelPendingUp() {
  pendingUp = false;
  if (upTimer) {
    dispatch_source_cancel(upTimer);
    upTimer = nil;
  }
}

void EmitUpAfterDelay();

void EmitUpAfterDelay() {
  if (upTimer) {
    dispatch_source_cancel(upTimer);
    upTimer = nil;
  }

  int64_t elapsed = CurrentTimeMs() - keyDownTime;
  int64_t delay = MIN_HOLD_MS - elapsed;
  if (delay <= 0) {
    isHotkeyPressed = false;
    pendingUp = false;
    EmitHotkeyState(false);
    return;
  }

  pendingUp = true;
  upTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
  dispatch_source_set_timer(upTimer, dispatch_time(DISPATCH_TIME_NOW, delay * NSEC_PER_MSEC), 0, 0);
  dispatch_source_set_event_handler(upTimer, ^{
    if (pendingUp) {
      isHotkeyPressed = false;
      pendingUp = false;
      EmitHotkeyState(false);
    }
    if (upTimer) {
      dispatch_source_cancel(upTimer);
      upTimer = nil;
    }
  });
  dispatch_resume(upTimer);
}

// MARK: - Key Code Mapping

unsigned short KeyCodeForToken(const std::string& token) {
  static const std::unordered_map<std::string, unsigned short> keyMap = {
    {"A", kVK_ANSI_A}, {"B", kVK_ANSI_B}, {"C", kVK_ANSI_C}, {"D", kVK_ANSI_D},
    {"E", kVK_ANSI_E}, {"F", kVK_ANSI_F}, {"G", kVK_ANSI_G}, {"H", kVK_ANSI_H},
    {"I", kVK_ANSI_I}, {"J", kVK_ANSI_J}, {"K", kVK_ANSI_K}, {"L", kVK_ANSI_L},
    {"M", kVK_ANSI_M}, {"N", kVK_ANSI_N}, {"O", kVK_ANSI_O}, {"P", kVK_ANSI_P},
    {"Q", kVK_ANSI_Q}, {"R", kVK_ANSI_R}, {"S", kVK_ANSI_S}, {"T", kVK_ANSI_T},
    {"U", kVK_ANSI_U}, {"V", kVK_ANSI_V}, {"W", kVK_ANSI_W}, {"X", kVK_ANSI_X},
    {"Y", kVK_ANSI_Y}, {"Z", kVK_ANSI_Z},
    // Number keys
    {"0", kVK_ANSI_0}, {"1", kVK_ANSI_1}, {"2", kVK_ANSI_2}, {"3", kVK_ANSI_3},
    {"4", kVK_ANSI_4}, {"5", kVK_ANSI_5}, {"6", kVK_ANSI_6}, {"7", kVK_ANSI_7},
    {"8", kVK_ANSI_8}, {"9", kVK_ANSI_9},
    // Function keys F1–F20
    {"F1",  kVK_F1},  {"F2",  kVK_F2},  {"F3",  kVK_F3},  {"F4",  kVK_F4},
    {"F5",  kVK_F5},  {"F6",  kVK_F6},  {"F7",  kVK_F7},  {"F8",  kVK_F8},
    {"F9",  kVK_F9},  {"F10", kVK_F10}, {"F11", kVK_F11}, {"F12", kVK_F12},
    {"F13", kVK_F13}, {"F14", kVK_F14}, {"F15", kVK_F15}, {"F16", kVK_F16},
    {"F17", kVK_F17}, {"F18", kVK_F18}, {"F19", kVK_F19}, {"F20", kVK_F20},
    // Special keys
    {"SPACE", kVK_Space}, {"RETURN", kVK_Return}, {"ENTER", kVK_Return},
    {"TAB", kVK_Tab}, {"ESCAPE", kVK_Escape}, {"ESC", kVK_Escape},
    {"UP", kVK_UpArrow}, {"DOWN", kVK_DownArrow},
    {"LEFT", kVK_LeftArrow}, {"RIGHT", kVK_RightArrow},
    {"FN", kVK_Function}
  };
  
  auto it = keyMap.find(token);
  return (it != keyMap.end()) ? it->second : USHRT_MAX;
}

// MARK: - Modifier Handling

CGEventFlags NormalizeModifiers(CGEventFlags flags) {
  return flags & (kCGEventFlagMaskCommand | kCGEventFlagMaskShift |
                  kCGEventFlagMaskAlternate | kCGEventFlagMaskControl);
}

bool RequiredModifiersPressed(CGEventFlags flags) {
  return (NormalizeModifiers(flags) & monitoredModifiers) == monitoredModifiers;
}

bool RequiredPasteLatestModifiersPressed(CGEventFlags flags) {
  return (NormalizeModifiers(flags) & pasteLatestModifiers) == pasteLatestModifiers;
}

// CGEvent doesn't expose Function key as a modifier flag like NSEvent does.
// Fn key state is tracked via both key code detection and flag bitmask.
// Note: On some keyboards, Fn only triggers FlagsChanged.
bool HasFnModifier(CGEventFlags flags) {
  return (flags & kCGEventFlagMaskSecondaryFn) || isFnKeyPressed;
}

// MARK: - Accelerator Configuration

bool ConfigureAccelerator(
    const std::string& accelerator,
    bool* outWatchesFunctionModifier,
    unsigned short* outKeyCode,
    CGEventFlags* outModifiers) {
  *outWatchesFunctionModifier = false;
  *outKeyCode = USHRT_MAX;
  *outModifiers = 0;

  if (accelerator == "Fn" || accelerator == "FN" || accelerator == "fn") {
    *outWatchesFunctionModifier = true;
    return true;
  }

  NSString* value = [NSString stringWithUTF8String:accelerator.c_str()];
  NSArray<NSString*>* tokens = [value.uppercaseString componentsSeparatedByString:@"+"];
  
  for (NSString* token in tokens) {
    NSString* trimmed = [token stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
    
    if ([trimmed isEqualToString:@"OPTION"] || [trimmed isEqualToString:@"ALT"]) {
      *outModifiers |= kCGEventFlagMaskAlternate;
      continue;
    }

    if ([trimmed isEqualToString:@"CMD"] || [trimmed isEqualToString:@"COMMAND"]) {
      *outModifiers |= kCGEventFlagMaskCommand;
      continue;
    }

    if ([trimmed isEqualToString:@"CTRL"] || [trimmed isEqualToString:@"CONTROL"]) {
      *outModifiers |= kCGEventFlagMaskControl;
      continue;
    }

    if ([trimmed isEqualToString:@"SHIFT"]) {
      *outModifiers |= kCGEventFlagMaskShift;
      continue;
    }

    if ([trimmed isEqualToString:@"FN"] || [trimmed isEqualToString:@"FUNCTION"]) {
      *outWatchesFunctionModifier = true;
      continue;
    }

    const unsigned short keyCode = KeyCodeForToken(trimmed.UTF8String);
    if (keyCode != USHRT_MAX) {
      *outKeyCode = keyCode;
    }
  }

  return *outKeyCode != USHRT_MAX || *outWatchesFunctionModifier;
}

bool ConfigurePrimaryAccelerator(const std::string& accelerator) {
  return ConfigureAccelerator(accelerator, &watchesFunctionModifier, &monitoredKeyCode, &monitoredModifiers);
}

bool ConfigurePasteLatestAccelerator(const std::string& accelerator) {
  return ConfigureAccelerator(accelerator, &pasteLatestWatchesFunctionModifier, &pasteLatestKeyCode, &pasteLatestModifiers);
}

// MARK: - Event Handling

void HandlePrimaryFlagsChanged(CGEventFlags flags) {
  if (watchesFunctionModifier) {
    bool hasFn = HasFnModifier(flags);
    
    if (hasFn == isHotkeyPressed && !pendingUp) {
      return;
    }

    if (hasFn) {
      CancelPendingUp();
      isHotkeyPressed = true;
      keyDownTime = CurrentTimeMs();
      EmitHotkeyState(true);
    } else {
      EmitUpAfterDelay();
    }
    return;
  }

  if (!isHotkeyPressed || monitoredModifiers == 0) {
    return;
  }

  if (!RequiredModifiersPressed(flags)) {
    EmitUpAfterDelay();
  }
}

void HandlePasteLatestFlagsChanged(CGEventFlags flags) {
  if (!pasteLatestWatchesFunctionModifier) {
    if (isPasteLatestPressed && pasteLatestModifiers != 0 && !RequiredPasteLatestModifiersPressed(flags)) {
      isPasteLatestPressed = false;
    }
    return;
  }

  bool hasFn = HasFnModifier(flags);
  if (hasFn && !isPasteLatestPressed) {
    isPasteLatestPressed = true;
    EmitPasteLatest();
  } else if (!hasFn) {
    isPasteLatestPressed = false;
  }
}

void HandlePrimaryKeyEvent(CGKeyCode keyCode, CGEventFlags flags, bool isPressed) {
  if (watchesFunctionModifier || monitoredKeyCode == USHRT_MAX) {
    return;
  }

  if (keyCode != monitoredKeyCode) {
    return;
  }

  if (!RequiredModifiersPressed(flags)) {
    if (!isPressed && isHotkeyPressed) {
      EmitUpAfterDelay();
    }
    return;
  }

  if (isHotkeyPressed == isPressed && !pendingUp) {
    return;
  }

  if (isPressed) {
    CancelPendingUp();
    isHotkeyPressed = true;
    keyDownTime = CurrentTimeMs();
    EmitHotkeyState(true);
  } else {
    EmitUpAfterDelay();
  }
}

void HandlePasteLatestKeyEvent(CGKeyCode keyCode, CGEventFlags flags, bool isPressed) {
  if (pasteLatestWatchesFunctionModifier || pasteLatestKeyCode == USHRT_MAX) {
    return;
  }

  if (keyCode != pasteLatestKeyCode) {
    if (!isPressed && isPasteLatestPressed) {
      isPasteLatestPressed = false;
    }
    return;
  }

  if (!RequiredPasteLatestModifiersPressed(flags)) {
    if (!isPressed) {
      isPasteLatestPressed = false;
    }
    return;
  }

  if (isPressed) {
    if (!isPasteLatestPressed) {
      isPasteLatestPressed = true;
      EmitPasteLatest();
    }
  } else {
    isPasteLatestPressed = false;
  }
}

// MARK: - CGEventTap Callbacks

CGEventRef PrimaryEventTapCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void* refcon) {
  // Re-enable tap if disabled by timeout or user input
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    if (primaryEventTap) {
      CGEventTapEnable(primaryEventTap, true);
    }
    return event;
  }

  CGEventFlags flags = CGEventGetFlags(event);
  
  switch (type) {
    case kCGEventFlagsChanged:
      HandlePrimaryFlagsChanged(flags);
      HandlePasteLatestFlagsChanged(flags);
      break;
      
    case kCGEventKeyDown: {
      CGKeyCode keyCode = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
      
      // Track Fn key state
      if (keyCode == kVK_Function) {
        isFnKeyPressed = true;
      }
      
      HandlePrimaryKeyEvent(keyCode, flags, true);
      HandlePasteLatestKeyEvent(keyCode, flags, true);
      break;
    }
      
    case kCGEventKeyUp: {
      CGKeyCode keyCode = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
      
      // Track Fn key state
      if (keyCode == kVK_Function) {
        isFnKeyPressed = false;
      }
      
      HandlePrimaryKeyEvent(keyCode, flags, false);
      HandlePasteLatestKeyEvent(keyCode, flags, false);
      break;
    }
      
    default:
      break;
  }

  return event; // Don't swallow events
}

// MARK: - Event Tap Thread

void* EventTapThreadFunc(void*) {
  @autoreleasepool {
    CGEventMask eventMask = 
      CGEventMaskBit(kCGEventKeyDown) |
      CGEventMaskBit(kCGEventKeyUp) |
      CGEventMaskBit(kCGEventFlagsChanged);

    // Create primary event tap
    primaryEventTap = CGEventTapCreate(
      kCGHIDEventTap,              // TRUE global - sees all events
      kCGHeadInsertEventTap,       // Insert at head to see events first
      kCGEventTapOptionDefault,    // Active tap, not listen-only
      eventMask,
      PrimaryEventTapCallback,
      nullptr
    );

    if (!primaryEventTap) {
      NSLog(@"[vaani] Failed to create CGEventTap - accessibility permission not granted");
      eventTapRunning = false;
      return nullptr;
    }

    primaryRunLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, primaryEventTap, 0);
    
    // Store reference to this thread's run loop
    eventTapRunLoop = CFRunLoopGetCurrent();
    CFRetain(eventTapRunLoop);
    
    CFRunLoopAddSource(eventTapRunLoop, primaryRunLoopSource, kCFRunLoopCommonModes);
    CGEventTapEnable(primaryEventTap, true);
    
    NSLog(@"[vaani] CGEventTap started successfully");
    CFRunLoopRun(); // Blocks this thread
    
    NSLog(@"[vaani] CGEventTap run loop exited");
    
    // Clean up the run loop reference
    if (eventTapRunLoop) {
      CFRelease(eventTapRunLoop);
      eventTapRunLoop = nullptr;
    }
  }
  
  return nullptr;
}

// MARK: - Control Functions

bool StartEventTap() {
  if (eventTapRunning) {
    return true;
  }

  // Check accessibility permission first
  if (!AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)@{(__bridge NSString*)kAXTrustedCheckOptionPrompt: @YES})) {
    NSLog(@"[vaani] Accessibility permission not granted");
    return false;
  }

  int result = pthread_create(&eventTapThread, nullptr, EventTapThreadFunc, nullptr);
  if (result != 0) {
    NSLog(@"[vaani] Failed to create event tap thread: %d", result);
    return false;
  }

  eventTapRunning = true;
  
  // Give the tap a moment to initialize
  [NSThread sleepForTimeInterval:0.05];
  
  return primaryEventTap != nullptr;
}

void StopEventTap() {
  CancelPendingUp();
  
  // Stop the run loop first to wake up the thread
  if (eventTapRunLoop) {
    CFRunLoopStop(eventTapRunLoop);
  }
  
  if (primaryEventTap) {
    CGEventTapEnable(primaryEventTap, false);
    CFMachPortInvalidate(primaryEventTap);
    CFRelease(primaryEventTap);
    primaryEventTap = nullptr;
  }
  
  if (primaryRunLoopSource) {
    if (eventTapRunLoop) {
      CFRunLoopRemoveSource(eventTapRunLoop, primaryRunLoopSource, kCFRunLoopCommonModes);
    }
    CFRunLoopSourceInvalidate(primaryRunLoopSource);
    CFRelease(primaryRunLoopSource);
    primaryRunLoopSource = nullptr;
  }
  
  // Wait for thread to finish
  if (eventTapThread != 0) {
    pthread_join(eventTapThread, nullptr);
    eventTapThread = 0;
  }
  
  // Clean up run loop reference
  if (eventTapRunLoop) {
    CFRelease(eventTapRunLoop);
    eventTapRunLoop = nullptr;
  }
  
  eventTapRunning = false;
  
  // Reset state
  isHotkeyPressed = false;
  pendingUp = false;
  watchesFunctionModifier = false;
  monitoredKeyCode = USHRT_MAX;
  monitoredModifiers = 0;
  isFnKeyPressed = false;
  
  if (hotkeyCallback) {
    hotkeyCallback.Release();
    hotkeyCallback = {};
  }
  
  // Also reset paste latest state
  isPasteLatestPressed = false;
  pasteLatestWatchesFunctionModifier = false;
  pasteLatestKeyCode = USHRT_MAX;
  pasteLatestModifiers = 0;
  
  if (pasteLatestCallback) {
    pasteLatestCallback.Release();
    pasteLatestCallback = {};
  }
}

// MARK: - NAPI Exports

Napi::Boolean StartHotkeyMonitor(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "Expected accelerator string and callback").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  std::string accelerator = info[0].As<Napi::String>().Utf8Value();
  
  if (!ConfigurePrimaryAccelerator(accelerator)) {
    return Napi::Boolean::New(env, false);
  }

  if (hotkeyCallback) {
    hotkeyCallback.Release();
  }

  hotkeyCallback = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(), "hotkey-monitor", 0, 1);
  
  bool started = StartEventTap();
  return Napi::Boolean::New(env, started);
}

Napi::Value StopHotkeyMonitor(const Napi::CallbackInfo& info) {
  StopEventTap();
  return info.Env().Undefined();
}

Napi::Boolean StartPasteLatestMonitor(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "Expected accelerator string and callback").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  std::string accelerator = info[0].As<Napi::String>().Utf8Value();
  
  if (!ConfigurePasteLatestAccelerator(accelerator)) {
    return Napi::Boolean::New(env, false);
  }

  if (pasteLatestCallback) {
    pasteLatestCallback.Release();
  }

  pasteLatestCallback = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(), "paste-latest-monitor", 0, 1);
  
  // The event tap is shared, so make sure it's running
  bool started = StartEventTap();
  return Napi::Boolean::New(env, started);
}

Napi::Value StopPasteLatestMonitor(const Napi::CallbackInfo& info) {
  // Just release the callback, don't stop the tap (primary might still need it)
  isPasteLatestPressed = false;
  pasteLatestWatchesFunctionModifier = false;
  pasteLatestKeyCode = USHRT_MAX;
  pasteLatestModifiers = 0;

  if (pasteLatestCallback) {
    pasteLatestCallback.Release();
    pasteLatestCallback = {};
  }

  // If primary is also stopped, then stop the tap
  if (!hotkeyCallback) {
    StopEventTap();
  }

  return info.Env().Undefined();
}

} // namespace

// MARK: - NAPI Module Initialization (must be outside anonymous namespace)

Napi::Object InitHotkeyMonitor(Napi::Env env, Napi::Object exports) {
  exports.Set("startHotkeyMonitor", Napi::Function::New(env, StartHotkeyMonitor));
  exports.Set("stopHotkeyMonitor", Napi::Function::New(env, StopHotkeyMonitor));
  exports.Set("startPasteLatestMonitor", Napi::Function::New(env, StartPasteLatestMonitor));
  exports.Set("stopPasteLatestMonitor", Napi::Function::New(env, StopPasteLatestMonitor));
  return exports;
}
