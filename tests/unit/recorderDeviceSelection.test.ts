import { describe, expect, it } from "vitest";
import type { AudioInputDevice } from "@shared/types";
import { selectRecorderDevice, selectRecorderDeviceId, type AudioInputLike } from "@renderer/recorder/deviceSelection";

function input(deviceId: string, label: string): AudioInputLike {
  return { kind: "audioinput", deviceId, label };
}

function native(uid: string, name: string, transportType: string, isPhysical = true): AudioInputDevice {
  return { uid, name, transportType, isDefault: false, isPhysical };
}

const builtIn = native("BuiltInMicrophoneDevice", "MacBook Pro Microphone", "built-in");
const headset = native("headset-uid", "Headset", "bluetooth");

describe("selectRecorderDevice", () => {
  it("matches the Chromium built-in label to the CoreAudio name with Bluetooth as default", () => {
    const devices = [
      input("default", "Default - Headset (Bluetooth)"),
      input("headset", "Headset (Bluetooth)"),
      input("virtual", "Background Music (Virtual)"),
      input("built-in", "MacBook Pro Microphone (Built-in)"),
    ];
    const nativeDevices = [headset, native("virtual-uid", "Background Music", "virtual", false), builtIn];
    expect(selectRecorderDeviceId(devices, nativeDevices)).toBe("built-in");
  });

  it("also matches undecorated labels, ignoring surrounding whitespace and case", () => {
    expect(selectRecorderDevice([input("built-in", " MACBOOK PRO MICROPHONE ")], undefined, [builtIn]))
      .toEqual({ ok: true, deviceId: "built-in" });
  });

  it("maps an explicit native UID to the decorated browser input", () => {
    const devices = [input("built-in", "MacBook Pro Microphone (Built-in)"), input("headset", "Headset (Bluetooth)")];
    expect(selectRecorderDevice(devices, headset.uid, [builtIn, headset])).toEqual({ ok: true, deviceId: "headset" });
    expect(selectRecorderDevice(devices, builtIn.uid, [builtIn, headset])).toEqual({ ok: true, deviceId: "built-in" });
  });

  it("honors an explicit browser input ID", () => {
    expect(selectRecorderDevice([input("headset", "Headset (Bluetooth)")], "headset", [headset]))
      .toEqual({ ok: true, deviceId: "headset" });
  });

  it("does not silently replace an unavailable configured mic", () => {
    expect(selectRecorderDevice([input("built-in", builtIn.name)], "missing", [builtIn]))
      .toEqual({ ok: false, message: "Selected microphone is unavailable." });
  });

  it("never automatically opens Bluetooth or virtual inputs when the built-in is absent", () => {
    expect(selectRecorderDevice([input("headset", "Headset (Bluetooth)")], undefined, [headset]))
      .toMatchObject({ ok: false, message: expect.stringContaining("No built-in microphone found") });
    expect(selectRecorderDevice([input("virtual", "MacBook Microphone (Virtual)")], undefined,
      [native("virtual", "MacBook Microphone", "virtual", false)]))
      .toMatchObject({ ok: false });
  });

  it("ignores default, communications and output devices", () => {
    const devices: AudioInputLike[] = [
      input("default", "MacBook Pro Microphone (Built-in)"),
      input("communications", "MacBook Pro Microphone (Built-in)"),
      { kind: "audiooutput", deviceId: "speaker", label: "MacBook Pro Microphone (Built-in)" },
    ];
    expect(selectRecorderDevice(devices, undefined, [builtIn])).toMatchObject({ ok: false });
  });

  it("requires one browser match instead of picking the first duplicate", () => {
    const devices = [input("one", "MacBook Pro Microphone (Built-in)"), input("two", "MacBook Pro Microphone (Built-in)")];
    expect(selectRecorderDevice(devices, undefined, [builtIn])).toMatchObject({ ok: false });
    expect(selectRecorderDevice(devices, builtIn.uid, [builtIn])).toMatchObject({ ok: false });
  });

  it("uses the suffix to distinguish a renamed Bluetooth mic from the built-in", () => {
    const renamed = native("bluetooth", builtIn.name, "bluetooth");
    const devices = [input("bluetooth", `${builtIn.name} (Bluetooth)`), input("built-in", `${builtIn.name} (Built-in)`)];
    expect(selectRecorderDevice(devices, undefined, [builtIn, renamed])).toEqual({ ok: true, deviceId: "built-in" });
  });

  it("rejects undecorated native name collisions, including virtual inputs", () => {
    const renamed = native("virtual", builtIn.name, "virtual", false);
    expect(selectRecorderDevice([input("mic", builtIn.name)], undefined, [builtIn, renamed]))
      .toMatchObject({ ok: false });
  });

  it("does not strip arbitrary parentheses or the wrong transport suffix", () => {
    for (const label of [`${builtIn.name} (Bluetooth)`, `${builtIn.name} (Virtual)`, `${builtIn.name} (Studio)`]) {
      expect(selectRecorderDevice([input("mic", label)], undefined, [builtIn])).toMatchObject({ ok: false });
    }
    const studio = native("studio", "Internal Microphone (Studio)", "built-in");
    expect(selectRecorderDevice([input("studio", "Internal Microphone (Studio) (Built-in)")], undefined, [studio]))
      .toEqual({ ok: true, deviceId: "studio" });
  });

  it("maps USB VID/PID suffixes and preserves parentheses in the native name", () => {
    const usb = native("usb-uid", "Microphone (Studio)", "usb");
    expect(selectRecorderDevice([input("usb", "Microphone (Studio) (1234:abcd)")], usb.uid, [usb]))
      .toEqual({ ok: true, deviceId: "usb" });
    expect(selectRecorderDevice([input("usb", "Microphone (Studio) (Other)")], usb.uid, [usb]))
      .toMatchObject({ ok: false });
  });

  it("fails safely when names or native device metadata are unavailable", () => {
    expect(selectRecorderDevice([input("mic", "")], undefined, [builtIn]))
      .toMatchObject({ ok: false, message: expect.stringContaining("Allow microphone access") });
    expect(selectRecorderDevice([input("mic", builtIn.name)], undefined, [])).toMatchObject({ ok: false });
    expect(selectRecorderDevice([input("mic", builtIn.name)], undefined, [builtIn, { ...builtIn, uid: "second" }]))
      .toMatchObject({ ok: false });
  });
});
