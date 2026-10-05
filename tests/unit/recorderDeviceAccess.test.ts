import { describe, expect, it, vi } from "vitest";
import { chooseRecorderDeviceId } from "@renderer/recorder/deviceSelection";
import type { AudioInputDevice } from "@shared/types";

const nativeMic: AudioInputDevice = {
  uid: "BuiltInMicrophoneDevice", name: "MacBook Pro Microphone", transportType: "built-in", isPhysical: true, isDefault: false,
};
const namedMic = { kind: "audioinput" as const, deviceId: "browser-built-in", label: "MacBook Pro Microphone (Built-in)" };
const unnamedMic = { ...namedMic, label: "" };

/** Mock permission and enumeration boundaries without opening any microphone. */
function access() {
  return {
    enumerateDevices: vi.fn().mockResolvedValue([namedMic]),
    listAudioInputDevices: vi.fn().mockResolvedValue([nativeMic]),
    requestMicrophonePermission: vi.fn().mockResolvedValue("granted"),
  };
}

describe("chooseRecorderDeviceId", () => {
  it("requests first-use permission and enumerates again before selecting", async () => {
    const api = access();
    api.enumerateDevices.mockResolvedValueOnce([unnamedMic]);
    await expect(chooseRecorderDeviceId(api)).resolves.toBe("browser-built-in");
    expect(api.requestMicrophonePermission).toHaveBeenCalledOnce();
    expect(api.enumerateDevices).toHaveBeenCalledTimes(2);
    expect(api.requestMicrophonePermission.mock.invocationCallOrder[0]).toBeLessThan(api.enumerateDevices.mock.invocationCallOrder[1]!);
  });

  it("also requests permission for the restricted default-only enumeration", async () => {
    const api = access();
    api.enumerateDevices.mockResolvedValueOnce([{ kind: "audioinput", deviceId: "default", label: "" }]);
    await expect(chooseRecorderDeviceId(api)).resolves.toBe("browser-built-in");
    expect(api.requestMicrophonePermission).toHaveBeenCalledOnce();
  });

  it("does not request permission again when names are already exposed", async () => {
    const api = access();
    await expect(chooseRecorderDeviceId(api, nativeMic.uid)).resolves.toBe("browser-built-in");
    expect(api.requestMicrophonePermission).not.toHaveBeenCalled();
  });

  it.each(["denied", "restricted"])("reports %s permission without trying another input", async (status) => {
    const api = access();
    api.enumerateDevices.mockResolvedValue([unnamedMic]);
    api.requestMicrophonePermission.mockResolvedValue(status);
    await expect(chooseRecorderDeviceId(api)).rejects.toThrow("Allow microphone access");
    expect(api.enumerateDevices).toHaveBeenCalledOnce();
  });

  it.each(["unknown", "not-determined"])("rechecks exposed names after a %s dev-mode permission result", async (status) => {
    const api = access();
    api.enumerateDevices.mockResolvedValueOnce([unnamedMic]);
    api.requestMicrophonePermission.mockResolvedValue(status);
    await expect(chooseRecorderDeviceId(api)).resolves.toBe("browser-built-in");
    expect(api.enumerateDevices).toHaveBeenCalledTimes(2);
  });

  it("fails with an actionable message if permission does not expose labels", async () => {
    const api = access();
    api.enumerateDevices.mockResolvedValue([unnamedMic]);
    await expect(chooseRecorderDeviceId(api)).rejects.toThrow("Microphone names are unavailable");
  });

  it("uses safe browser selection when native enumeration rejects", async () => {
    const api = access();
    api.listAudioInputDevices.mockRejectedValue(new Error("native addon unavailable"));
    await expect(chooseRecorderDeviceId(api)).resolves.toBe("browser-built-in");
  });
});
