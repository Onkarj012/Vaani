import { describe, expect, it, vi } from "vitest";
import type { AudioClip, AudioInputDevice, RecorderConfig, RecorderSubmission } from "@shared/types";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import { CaptureBackendController, NativeCaptureService, selectNativeInputDevice, shouldUseNativeBackend, type NativeCaptureSink } from "@main/audio/nativeCapture";

function device(overrides: Partial<AudioInputDevice>): AudioInputDevice {
  return {
    uid: "uid",
    name: "Built-in Microphone",
    transportType: "built-in",
    isDefault: false,
    isPhysical: true,
    ...overrides,
  };
}

describe("selectNativeInputDevice", () => {
  it("honors a preferred physical native UID", () => {
    const devices = [
      device({ uid: "default", isDefault: true }),
      device({ uid: "preferred", name: "USB Mic" }),
    ];

    expect(selectNativeInputDevice(devices, "preferred")).toEqual({ ok: true, uid: "preferred" });
  });

  it("reports a missing selected UID instead of falling back to built-in", () => {
    const devices = [
      device({ uid: "virtual", isPhysical: false, transportType: "virtual" }),
      device({ uid: "bt", name: "Headset", transportType: "bluetooth", isDefault: true }),
      device({ uid: "built-in" }),
    ];

    expect(selectNativeInputDevice(devices, "missing")).toEqual({ ok: false, message: "Selected microphone is unavailable." });
  });

  it("prefers built-in over a default Bluetooth input", () => {
    const devices = [
      device({ uid: "bt", name: "Headset", transportType: "bluetooth", isDefault: true }),
      device({ uid: "built-in" }),
    ];

    expect(selectNativeInputDevice(devices)).toEqual({ ok: true, uid: "built-in" });
  });

  it("skips Bluetooth and Bluetooth LE when selecting the built-in input", () => {
    const devices = [
      device({ uid: "bt", name: "Headset", transportType: "bluetooth", isDefault: true }),
      device({ uid: "ble", name: "LE Headset", transportType: "bluetooth-le" }),
      device({ uid: "built-in" }),
    ];

    expect(selectNativeInputDevice(devices)).toEqual({ ok: true, uid: "built-in" });
  });

  it("refuses to choose when only Bluetooth inputs are available", () => {
    const devices = [
      device({ uid: "bt", name: "Headset", transportType: "bluetooth", isDefault: true }),
      device({ uid: "ble", name: "LE Headset", transportType: "bluetooth-le" }),
    ];

    expect(selectNativeInputDevice(devices)).toMatchObject({ ok: false });
  });

  it("honors an explicit Bluetooth UID", () => {
    const devices = [
      device({ uid: "bt", name: "Headset", transportType: "bluetooth", isDefault: true }),
      device({ uid: "built-in" }),
    ];

    expect(selectNativeInputDevice(devices, "bt")).toEqual({ ok: true, uid: "bt" });
  });

  it("errors when only virtual or aggregate inputs are present", () => {
    const devices = [
      device({ uid: "virtual", isPhysical: false, transportType: "virtual" }),
      device({ uid: "aggregate", isPhysical: false, transportType: "aggregate" }),
    ];

    expect(selectNativeInputDevice(devices)).toEqual({
      ok: false,
      message: expect.stringContaining("No built-in microphone found"),
    });
  });
});

describe("shouldUseNativeBackend", () => {
  it("keeps renderer capture as the default backend", () => {
    expect(DEFAULT_SETTINGS.captureBackend).toBe("renderer");
    expect(shouldUseNativeBackend({ captureBackend: DEFAULT_SETTINGS.captureBackend }, false, { audioCaptureStart: vi.fn() })).toBe(false);
  });

  it("uses native by default when bridge support exists", () => {
    expect(shouldUseNativeBackend({ captureBackend: "native" }, false, { audioCaptureStart: vi.fn() })).toBe(true);
  });

  it("does not use native when renderer backend is selected or native is unavailable", () => {
    expect(shouldUseNativeBackend({ captureBackend: "renderer" }, false, { audioCaptureStart: vi.fn() })).toBe(false);
    expect(shouldUseNativeBackend({ captureBackend: "native" }, true, { audioCaptureStart: vi.fn() })).toBe(false);
  });

  it("keeps unprocessed capture on the renderer even when native is selected", () => {
    expect(shouldUseNativeBackend({ captureBackend: "native", captureProcessing: "unprocessed" }, false, { audioCaptureStart: vi.fn() })).toBe(false);
    expect(shouldUseNativeBackend({ captureBackend: "native", captureProcessing: "default" }, false, { audioCaptureStart: vi.fn() })).toBe(true);
  });
});

describe("CaptureBackendController", () => {
  it("routes renderer lifecycle suspension and cancellation through the active backend", () => {
    const config: RecorderConfig = { preWarmMic: false, captureBackend: "renderer" };
    const native = new NativeCaptureService(() => config, {
      reportRecorderStarted: vi.fn(),
      submitAudioClip: vi.fn(),
      updateAudioLevel: vi.fn(),
      handleRecorderFailure: vi.fn(),
    }, {});
    const renderer = {
      isReady: vi.fn(() => true),
      startRecording: vi.fn(() => true),
      stopRecording: vi.fn(() => true),
      abortRecording: vi.fn(),
      suspendForLifecycle: vi.fn(() => ({ wasRunning: true, sessionId: "renderer-session" })),
      resumeAfterLifecycle: vi.fn(() => ({ ok: true as const, selectedDeviceUid: null })),
    };
    const controller = new CaptureBackendController(() => config, native, renderer);

    expect(controller.startRecording("renderer-session")).toBe(true);
    expect(controller.suspendForLifecycle()).toEqual({ wasRunning: true, sessionId: "renderer-session" });
    expect(renderer.suspendForLifecycle).toHaveBeenCalledTimes(1);
    expect(controller.resumeAfterLifecycle()).toMatchObject({ ok: true });
    controller.abortRecording("renderer-session");
    expect(renderer.abortRecording).toHaveBeenCalledWith("renderer-session");
  });

  it("falls back to renderer when native start fails", () => {
    const config: RecorderConfig = { preWarmMic: true, captureBackend: "native" };
    const native = {
      isReady: vi.fn(() => true),
      startRecording: vi.fn(() => false),
      stopRecording: vi.fn(() => true),
      shutdown: vi.fn(),
    } as unknown as NativeCaptureService;
    const renderer = {
      isReady: vi.fn(() => true),
      startRecording: vi.fn(() => true),
      stopRecording: vi.fn(() => true),
    };
    const controller = new CaptureBackendController(() => config, native, renderer);

    expect(controller.startRecording("s1")).toBe(true);
    expect(native.startRecording).toHaveBeenCalledWith("s1");
    expect(renderer.startRecording).toHaveBeenCalledWith("s1");
  });

  it("records unprocessed sessions on the renderer and routes lifecycle calls there", () => {
    const config: RecorderConfig = { preWarmMic: true, captureBackend: "native", captureProcessing: "unprocessed" };
    const native = {
      isReady: vi.fn(() => true),
      startRecording: vi.fn(() => true),
      stopRecording: vi.fn(() => true),
      shutdown: vi.fn(),
      suspendForLifecycle: vi.fn(() => ({ wasRunning: false, sessionId: null })),
    } as unknown as NativeCaptureService;
    const renderer = {
      isReady: vi.fn(() => true),
      startRecording: vi.fn(() => true),
      stopRecording: vi.fn(() => true),
      suspendForLifecycle: vi.fn(() => ({ wasRunning: true, sessionId: "s2" })),
    };
    const controller = new CaptureBackendController(() => config, native, renderer);

    expect(controller.startRecording("s2")).toBe(true);
    expect(native.startRecording).not.toHaveBeenCalled();
    expect(renderer.startRecording).toHaveBeenCalledWith("s2");
    expect(controller.suspendForLifecycle()).toEqual({ wasRunning: true, sessionId: "s2" });
    expect(native.suspendForLifecycle).not.toHaveBeenCalled();
  });

  it("keeps suspension and resume on the native backend when processing changes mid-session", () => {
    const config: RecorderConfig = { preWarmMic: false, captureBackend: "native", captureProcessing: "default" };
    const partialClip: AudioClip = { pcmData: [0.1, 0.2], sampleRate: 16_000, durationSeconds: 2 / 16_000, rmsFrames: [0.1] };
    const native = {
      isReady: vi.fn(() => true),
      startRecording: vi.fn(() => true),
      stopRecording: vi.fn(() => true),
      shutdown: vi.fn(),
      hasActiveSession: vi.fn(() => true),
      suspendForLifecycle: vi.fn(() => ({ wasRunning: true, sessionId: "s3", partialClip })),
      resumeAfterLifecycle: vi.fn(() => ({ ok: true as const, selectedDeviceUid: "built-in" })),
    } as unknown as NativeCaptureService;
    const renderer = {
      isReady: vi.fn(() => true),
      startRecording: vi.fn(() => true),
      stopRecording: vi.fn(() => true),
      suspendForLifecycle: vi.fn(() => ({ wasRunning: false, sessionId: null })),
      resumeAfterLifecycle: vi.fn(() => ({ ok: true as const, selectedDeviceUid: null })),
    };
    const controller = new CaptureBackendController(() => config, native, renderer);

    expect(controller.startRecording("s3")).toBe(true);
    config.captureProcessing = "unprocessed";
    expect(controller.suspendForLifecycle()).toEqual({ wasRunning: true, sessionId: "s3", partialClip });
    expect(native.suspendForLifecycle).toHaveBeenCalledTimes(1);
    expect(renderer.suspendForLifecycle).not.toHaveBeenCalled();
    expect(controller.resumeAfterLifecycle()).toMatchObject({ ok: true, selectedDeviceUid: "built-in" });
    expect(native.resumeAfterLifecycle).toHaveBeenCalledTimes(1);
    expect(renderer.resumeAfterLifecycle).not.toHaveBeenCalled();
  });

  it("follows the configured backend for lifecycle calls when idle", () => {
    const config: RecorderConfig = { preWarmMic: false, captureBackend: "native", captureProcessing: "unprocessed" };
    const native = {
      isReady: vi.fn(() => true),
      startRecording: vi.fn(() => true),
      stopRecording: vi.fn(() => true),
      shutdown: vi.fn(),
      suspendForLifecycle: vi.fn(() => ({ wasRunning: false, sessionId: null })),
      resumeAfterLifecycle: vi.fn(() => ({ ok: true as const, selectedDeviceUid: "built-in" })),
    } as unknown as NativeCaptureService;
    const renderer = {
      isReady: vi.fn(() => true),
      startRecording: vi.fn(() => true),
      stopRecording: vi.fn(() => true),
      suspendForLifecycle: vi.fn(() => ({ wasRunning: false, sessionId: null })),
      resumeAfterLifecycle: vi.fn(() => ({ ok: true as const, selectedDeviceUid: null })),
    };
    const controller = new CaptureBackendController(() => config, native, renderer);

    expect(controller.suspendForLifecycle()).toEqual({ wasRunning: false, sessionId: null });
    expect(renderer.suspendForLifecycle).toHaveBeenCalledTimes(1);
    expect(native.suspendForLifecycle).not.toHaveBeenCalled();
    expect(controller.resumeAfterLifecycle()).toMatchObject({ ok: true });
    expect(renderer.resumeAfterLifecycle).toHaveBeenCalledTimes(1);

    config.captureProcessing = "default";
    controller.suspendForLifecycle();
    expect(native.suspendForLifecycle).toHaveBeenCalledTimes(1);
  });

  it("routes lifecycle by config once a native session has fully stopped", () => {
    vi.useFakeTimers();
    try {
      const { controller, native, renderer, sink, config, emit } = liveNativeController();
      expect(controller.startRecording("s4")).toBe(true);
      emit(new Float32Array(16_000).fill(0.02));
      expect(controller.stopRecording("s4")).toBe(true);
      vi.advanceTimersByTime(10_000);
      expect(sink.submitAudioClip).toHaveBeenCalledTimes(1);

      config.captureProcessing = "unprocessed";
      const nativeSuspend = vi.spyOn(native, "suspendForLifecycle");
      controller.suspendForLifecycle();
      expect(renderer.suspendForLifecycle).toHaveBeenCalledTimes(1);
      expect(nativeSuspend).not.toHaveBeenCalled();
      expect(controller.resumeAfterLifecycle()).toMatchObject({ ok: true });
      expect(renderer.resumeAfterLifecycle).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a native session still draining after stop on the native backend", () => {
    vi.useFakeTimers();
    try {
      const { controller, native, renderer, config } = liveNativeController();
      expect(controller.startRecording("s5")).toBe(true);
      expect(controller.stopRecording("s5")).toBe(true);

      config.captureProcessing = "unprocessed";
      const nativeSuspend = vi.spyOn(native, "suspendForLifecycle");
      controller.suspendForLifecycle();
      expect(nativeSuspend).toHaveBeenCalledTimes(1);
      expect(renderer.suspendForLifecycle).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Builds a controller over a real NativeCaptureService with a mock mic bridge.
function liveNativeController() {
  const config: RecorderConfig = { preWarmMic: true, captureBackend: "native", captureProcessing: "default" };
  let onData: ((samples: Float32Array) => void) | undefined;
  const bridge = {
    audioCaptureStart: vi.fn((options: { onData: (samples: Float32Array) => void }) => {
      onData = options.onData;
      return true;
    }),
    audioCaptureStop: vi.fn(),
    audioCaptureListInputDevices: vi.fn(() => [device({ uid: "built-in", isDefault: true })]),
    audioCaptureIsRunning: vi.fn(() => false),
  };
  const sink: NativeCaptureSink = {
    reportRecorderStarted: vi.fn(),
    submitAudioClip: vi.fn(),
    updateAudioLevel: vi.fn(),
    handleRecorderFailure: vi.fn(),
  };
  const native = new NativeCaptureService(() => config, sink, bridge);
  const renderer = {
    isReady: vi.fn(() => true),
    startRecording: vi.fn(() => true),
    stopRecording: vi.fn(() => true),
    suspendForLifecycle: vi.fn(() => ({ wasRunning: false, sessionId: null })),
    resumeAfterLifecycle: vi.fn(() => ({ ok: true as const, selectedDeviceUid: null })),
  };
  const controller = new CaptureBackendController(() => config, native, renderer);
  return { controller, native, renderer, sink, config, emit: (samples: Float32Array) => onData?.(samples) };
}

describe("NativeCaptureService", () => {
  it("submits last-frame timing and final 300 ms loudness with the clip", async () => {
    vi.useFakeTimers();
    try {
      let onData: ((samples: Float32Array) => void) | undefined;
      const submitAudioClip = vi.fn<(payload: RecorderSubmission) => void>();
      const bridge = {
        audioCaptureStart: vi.fn((options: { onData: (samples: Float32Array) => void }) => {
          onData = options.onData;
          return true;
        }),
        audioCaptureStop: vi.fn(),
        audioCaptureListInputDevices: vi.fn(() => [device({ uid: "built-in", isDefault: true })]),
      };
      const service = new NativeCaptureService(
        () => ({ preWarmMic: false, captureBackend: "native" }),
        { reportRecorderStarted: vi.fn(), submitAudioClip, updateAudioLevel: vi.fn(), handleRecorderFailure: vi.fn() },
        bridge,
      );

      expect(service.startRecording("s1")).toBe(true);
      expect(service.stopRecording("s1")).toBe(true);
      await vi.advanceTimersByTimeAsync(50);
      onData?.(new Float32Array(16_000).fill(0.02));
      await vi.advanceTimersByTimeAsync(370);
      expect(submitAudioClip.mock.calls[0]?.[0].tailMetrics?.lastFrameAfterStopMs).toBe(50);
      expect(submitAudioClip.mock.calls[0]?.[0].tailMetrics?.trailingRms).toBeCloseTo(0.02);
      expect(submitAudioClip.mock.calls[0]?.[0].captureSettings).toEqual({ echoCancellation: true, autoGainControl: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps suspension retryable after a failed resume and makes a later success idempotent", () => {
    const config: RecorderConfig = { preWarmMic: true, captureBackend: "native", micDeviceId: "built-in" };
    let startSucceeds = true;
    const sink: NativeCaptureSink = {
      reportRecorderStarted: vi.fn(),
      submitAudioClip: vi.fn(),
      updateAudioLevel: vi.fn(),
      handleRecorderFailure: vi.fn(),
    };
    const bridge = {
      audioCaptureStart: vi.fn(() => startSucceeds),
      audioCaptureStop: vi.fn(),
      audioCaptureListInputDevices: vi.fn(() => [device({ uid: "built-in", isDefault: true })]),
      audioCaptureIsRunning: vi.fn(() => false),
    };
    const service = new NativeCaptureService(() => config, sink, bridge);
    expect(service.warm()).toBe(true);
    service.suspendForLifecycle();
    startSucceeds = false;
    expect(service.resumeAfterLifecycle()).toMatchObject({ ok: false });
    startSucceeds = true;
    expect(service.resumeAfterLifecycle()).toMatchObject({ ok: true, selectedDeviceUid: "built-in" });
    const startsAfterSuccessfulResume = bridge.audioCaptureStart.mock.calls.length;
    expect(service.resumeAfterLifecycle()).toMatchObject({ ok: true, selectedDeviceUid: "built-in" });
    expect(bridge.audioCaptureStart).toHaveBeenCalledTimes(startsAfterSuccessfulResume);
  });

  it("reports the session started on the first captured frame, not when capture opens", () => {
    let onData: ((samples: Float32Array) => void) | undefined;
    const sink: NativeCaptureSink = {
      reportRecorderStarted: vi.fn(),
      submitAudioClip: vi.fn(),
      updateAudioLevel: vi.fn(),
      handleRecorderFailure: vi.fn(),
    };
    const bridge = {
      audioCaptureStart: vi.fn((options: { onData: (samples: Float32Array) => void }) => {
        onData = options.onData;
        return true;
      }),
      audioCaptureStop: vi.fn(),
      audioCaptureListInputDevices: vi.fn(() => [device({ uid: "built-in", isDefault: true })]),
      audioCaptureIsRunning: vi.fn(() => false),
    };
    const service = new NativeCaptureService(() => ({ preWarmMic: false, captureBackend: "native" }), sink, bridge);

    expect(service.startRecording("s1")).toBe(true);
    expect(sink.reportRecorderStarted).not.toHaveBeenCalled();
    onData?.(new Float32Array(0));
    expect(sink.reportRecorderStarted).not.toHaveBeenCalled();
    onData?.(new Float32Array(320).fill(0.01));
    onData?.(new Float32Array(320).fill(0.01));
    expect(sink.reportRecorderStarted).toHaveBeenCalledTimes(1);
    expect(sink.reportRecorderStarted).toHaveBeenCalledWith("s1");
  });

  it("defers capture rebuilds while a session is active", () => {
    let config: RecorderConfig = { preWarmMic: true, captureBackend: "native", micDeviceId: "built-in" };
    let onData: ((samples: Float32Array) => void) | undefined;
    const sink: NativeCaptureSink = {
      reportRecorderStarted: vi.fn(),
      submitAudioClip: vi.fn(),
      updateAudioLevel: vi.fn(),
      handleRecorderFailure: vi.fn(),
    };
    const bridge = {
      audioCaptureStart: vi.fn((options: { onData: (samples: Float32Array) => void }) => {
        onData = options.onData;
        return true;
      }),
      audioCaptureStop: vi.fn(),
      audioCaptureListInputDevices: vi.fn(() => [
        device({ uid: "built-in", isDefault: true }),
        device({ uid: "usb", name: "USB Microphone" }),
      ]),
      audioCaptureIsRunning: vi.fn(() => false),
    };
    const service = new NativeCaptureService(() => config, sink, bridge);

    expect(service.startRecording("s1")).toBe(true);
    onData?.(new Float32Array(320).fill(0.01));
    bridge.audioCaptureStop.mockClear();

    config = { preWarmMic: true, captureBackend: "native", micDeviceId: "usb" };
    service.updateConfig(config);

    expect(bridge.audioCaptureStop).not.toHaveBeenCalled();
    expect(sink.reportRecorderStarted).toHaveBeenCalledWith("s1");
  });

  it("aborts a native session before state reset without submitting a clip", () => {
    const config: RecorderConfig = { preWarmMic: false, captureBackend: "native" };
    const sink: NativeCaptureSink = {
      reportRecorderStarted: vi.fn(),
      submitAudioClip: vi.fn(),
      updateAudioLevel: vi.fn(),
      handleRecorderFailure: vi.fn(),
    };
    const bridge = {
      audioCaptureStart: vi.fn(() => true),
      audioCaptureStop: vi.fn(),
      audioCaptureListInputDevices: vi.fn(() => [device({ uid: "built-in", isDefault: true })]),
      audioCaptureIsRunning: vi.fn(() => false),
    };
    const service = new NativeCaptureService(() => config, sink, bridge);
    expect(service.startRecording("native-session")).toBe(true);
    service.abortRecording("native-session");
    expect(bridge.audioCaptureStop).toHaveBeenCalled();
    expect(service.stopRecording("native-session")).toBe(true);
    expect(sink.submitAudioClip).not.toHaveBeenCalled();
  });
});
