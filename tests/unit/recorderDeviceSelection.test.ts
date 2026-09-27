import { describe, expect, it } from "vitest";
import type { AudioInputDevice } from "@shared/types";
import { selectRecorderDevice, selectRecorderDeviceId, type AudioInputLike } from "@renderer/recorder/deviceSelection";

function input(deviceId: string, label: string): AudioInputLike {
  return { kind: "audioinput", deviceId, label };
}

function native(uid: string, name: string, transportType: string): AudioInputDevice {
  return { uid, name, transportType, isDefault: false, isPhysical: true };
}

describe("selectRecorderDevice", () => {
  const builtIn = native("coreaudio-built-in", "Internal Microphone", "built-in");

  it("matches the unique CoreAudio built-in device to the browser input", () => {
    const devices = [input("usb", "USB Microphone"), input("browser-built-in", "Internal Microphone")];
    expect(selectRecorderDeviceId(devices, [builtIn])).toBe("browser-built-in");
  });

  it("ignores a Bluetooth input named Internal Microphone when CoreAudio names a different built-in", () => {
    const devices = [input("bluetooth", "Internal Microphone"), input("browser-built-in", "MacBook Pro Microphone")];
    const macBookMic = native("coreaudio-built-in", "MacBook Pro Microphone", "built-in");
    expect(selectRecorderDeviceId(devices, [macBookMic])).toBe("browser-built-in");
  });

  it("refuses a renamed Bluetooth input that shares the built-in label", () => {
    const devices = [input("bluetooth", "Internal Microphone"), input("browser-built-in", "Internal Microphone")];
    const renamedBluetooth = native("bt", "Internal Microphone", "bluetooth");
    expect(selectRecorderDevice(devices, undefined, [builtIn, renamedBluetooth])).toMatchObject({ ok: false });
    expect(selectRecorderDevice([input("bluetooth", "Internal Microphone")], undefined, [builtIn, renamedBluetooth]))
      .toMatchObject({ ok: false });
  });

  it("fails closed without one unique native built-in and browser match", () => {
    const devices = [input("browser-built-in", "Internal Microphone")];
    expect(selectRecorderDeviceId(devices, [])).toBeUndefined();
    expect(selectRecorderDeviceId(devices, [builtIn, native("second", "Internal Microphone", "built-in")])).toBeUndefined();
    expect(selectRecorderDeviceId([input("other", "External")], [builtIn])).toBeUndefined();
    expect(selectRecorderDeviceId([{ kind: "audiooutput", deviceId: "speaker", label: "Internal Microphone" }], [builtIn])).toBeUndefined();
  });

  it("explains how to recover when first-use enumeration has empty labels", () => {
    expect(selectRecorderDevice([input("built-in", "")], undefined, [builtIn])).toEqual({
      ok: false,
      message: expect.stringContaining("Allow microphone access for Vaani"),
    });
  });

  it("honors an explicitly selected browser input", () => {
    expect(selectRecorderDevice([input("usb", "USB Microphone")], "usb")).toEqual({ ok: true, deviceId: "usb" });
  });

  it("maps an explicitly selected native UID only with a unique browser label", () => {
    const headset = native("coreaudio-headset", "Headset Microphone", "bluetooth");
    expect(selectRecorderDevice([input("headset", "Headset Microphone")], headset.uid, [headset]))
      .toEqual({ ok: true, deviceId: "headset" });
    expect(selectRecorderDevice([input("one", "Headset Microphone"), input("two", "Headset Microphone")], headset.uid, [headset]))
      .toMatchObject({ ok: false, message: expect.stringContaining("Selected microphone") });
  });

  it("reports a missing explicit device instead of selecting built-in", () => {
    const devices = [input("browser-built-in", "Internal Microphone")];
    expect(selectRecorderDevice(devices, "missing", [builtIn]))
      .toEqual({ ok: false, message: "Selected microphone is unavailable." });
  });
});
