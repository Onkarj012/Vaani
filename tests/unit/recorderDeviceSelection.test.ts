import { describe, expect, it } from "vitest";
import { selectRecorderDevice, selectRecorderDeviceId, type AudioInputLike } from "@renderer/recorder/deviceSelection";

function input(deviceId: string, label: string): AudioInputLike {
  return { kind: "audioinput", deviceId, label };
}

describe("selectRecorderDeviceId", () => {
  it("prefers the built-in mic over virtual and external inputs", () => {
    const devices = [
      input("vd", "BlackHole 2ch"),
      input("ext", "Scarlett 2i2"),
      input("bi", "MacBook Pro Microphone"),
    ];
    expect(selectRecorderDeviceId(devices)).toBe("bi");
  });

  it("does not select an external mic by default", () => {
    const devices = [input("vd", "BlackHole 2ch"), input("ext", "USB Microphone")];
    expect(selectRecorderDeviceId(devices)).toBeUndefined();
  });

  it("skips Bluetooth and Bluetooth LE inputs before the built-in mic", () => {
    const devices = [
      input("bt", "Bluetooth Headset"),
      input("ble", "Bluetooth LE Microphone"),
      input("bi", "Built-in Microphone"),
    ];
    expect(selectRecorderDeviceId(devices)).toBe("bi");
  });

  it("does not mistake a Bluetooth device with a built-in label for the Mac mic", () => {
    const devices = [input("bt", "Built-in Bluetooth Headset"), input("bi", "MacBook Pro Microphone")];
    expect(selectRecorderDeviceId(devices)).toBe("bi");
  });

  it("fails closed when no built-in mic exists", () => {
    const devices = [
      input("agg", "Aggregate Device"),
      input("ext1", "USB Microphone"),
      input("ext2", "Scarlett 2i2"),
    ];
    expect(selectRecorderDeviceId(devices)).toBeUndefined();
  });

  it("returns undefined when only virtual inputs exist", () => {
    const devices = [input("vd", "BlackHole 16ch"), input("lb", "Loopback Audio")];
    expect(selectRecorderDeviceId(devices)).toBeUndefined();
  });

  it("returns an error instead of falling back to default when only virtual inputs exist", () => {
    const devices = [input("vd", "BlackHole 16ch"), input("lb", "Loopback Audio")];

    expect(selectRecorderDevice(devices)).toEqual({
      ok: false,
      message: expect.stringContaining("No built-in microphone found"),
    });
  });

  it("honors an explicitly selected Bluetooth mic when it is present", () => {
    const devices = [
      input("bi", "MacBook Pro Microphone"),
      input("preferred", "Bluetooth Headset"),
    ];

    expect(selectRecorderDevice(devices, "preferred")).toEqual({ ok: true, deviceId: "preferred" });
  });

  it("maps an explicitly selected native UID to the browser device ID", () => {
    const devices = [input("browser-built-in", "MacBook Pro Microphone"), input("browser-headset", "Headset Microphone")];
    const nativeDevices = [{ uid: "coreaudio-headset", name: "Headset Microphone" }];

    expect(selectRecorderDevice(devices, "coreaudio-headset", nativeDevices)).toEqual({ ok: true, deviceId: "browser-headset" });
  });

  it("does not guess when a native UID matches multiple browser labels", () => {
    const devices = [
      input("browser-built-in", "MacBook Pro Microphone"),
      input("headset-1", "Headset Microphone"),
      input("headset-2", "Headset Microphone"),
    ];
    const nativeDevices = [{ uid: "coreaudio-headset", name: "Headset Microphone" }];

    expect(selectRecorderDevice(devices, "coreaudio-headset", nativeDevices)).toEqual({
      ok: false,
      message: expect.stringContaining("could not be matched"),
    });
  });

  it("falls back to built-in device selection when configured micDeviceId is missing", () => {
    const devices = [
      input("vd", "BlackHole 16ch"),
      input("bi", "Built-in Microphone"),
    ];

    expect(selectRecorderDevice(devices, "missing")).toEqual({ ok: true, deviceId: "bi" });
  });

  it("ignores default and communications pseudo-devices", () => {
    const devices = [
      input("default", "Default"),
      input("communications", "Communications"),
      input("bi", "Built-in Microphone"),
    ];
    expect(selectRecorderDeviceId(devices)).toBe("bi");
  });

  it("does not select a device with an unknown label by default", () => {
    const devices = [input("x", "")];
    expect(selectRecorderDeviceId(devices)).toBeUndefined();
  });

  it("excludes non-audioinput devices", () => {
    const devices: AudioInputLike[] = [
      { kind: "audiooutput", deviceId: "spk", label: "Speakers" },
      input("bi", "Built-in Microphone"),
    ];
    expect(selectRecorderDeviceId(devices)).toBe("bi");
  });
});
