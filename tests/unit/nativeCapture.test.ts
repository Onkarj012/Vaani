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
});
