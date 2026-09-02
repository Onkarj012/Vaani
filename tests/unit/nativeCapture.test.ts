import { describe, expect, it, vi } from "vitest";
import type { AudioInputDevice, RecorderConfig } from "@shared/types";
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

  it("falls back to the physical default device", () => {
    const devices = [
      device({ uid: "virtual", isPhysical: false, transportType: "virtual" }),
      device({ uid: "default", isDefault: true }),
    ];

    expect(selectNativeInputDevice(devices, "missing")).toEqual({ ok: true, uid: "default" });
  });

  it("errors when only virtual or aggregate inputs are present", () => {
    const devices = [
      device({ uid: "virtual", isPhysical: false, transportType: "virtual" }),
      device({ uid: "aggregate", isPhysical: false, transportType: "aggregate" }),
    ];

    expect(selectNativeInputDevice(devices)).toEqual({
      ok: false,
      message: expect.stringContaining("No physical microphone found"),
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
});

describe("NativeCaptureService", () => {
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

  it("defers capture rebuilds while a session is active", () => {
    let config: RecorderConfig = { preWarmMic: true, captureBackend: "native", micDeviceId: "built-in" };
    const sink: NativeCaptureSink = {
      reportRecorderStarted: vi.fn(),
      submitAudioClip: vi.fn(),
      updateAudioLevel: vi.fn(),
      handleRecorderFailure: vi.fn(),
    };
    const bridge = {
      audioCaptureStart: vi.fn(() => true),
      audioCaptureStop: vi.fn(),
      audioCaptureListInputDevices: vi.fn(() => [
        device({ uid: "built-in", isDefault: true }),
        device({ uid: "usb", name: "USB Microphone" }),
      ]),
      audioCaptureIsRunning: vi.fn(() => false),
    };
    const service = new NativeCaptureService(() => config, sink, bridge);

    expect(service.startRecording("s1")).toBe(true);
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
