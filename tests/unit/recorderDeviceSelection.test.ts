import { describe, expect, it } from "vitest";
import type { AudioInputDevice } from "@shared/types";
import { selectRecorderDevice, selectRecorderDeviceId, type AudioInputLike } from "@renderer/recorder/deviceSelection";

/** Build a browser enumeration fixture with a stable ID and label. */
function input(deviceId: string, label: string): AudioInputLike {
  return { kind: "audioinput", deviceId, label };
}

/** Build CoreAudio metadata independently from the browser label. */
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

  it("never automatically opens virtual inputs when the built-in is absent", () => {
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

  it("fails safely when names or native identity are ambiguous", () => {
    expect(selectRecorderDevice([input("mic", "")], undefined, [builtIn]))
      .toMatchObject({ ok: false, message: expect.stringContaining("Allow microphone access") });
    expect(selectRecorderDevice([input("mic", "Unknown")], undefined, [])).toMatchObject({ ok: false });
    expect(selectRecorderDevice([input("mic", builtIn.name)], undefined, [builtIn, { ...builtIn, uid: "second" }]))
      .toMatchObject({ ok: false });
  });
});

describe("review regressions", () => {
  it("uses an external physical input when no built-in exists", () => {
    const usb = native("usb-uid", "USB Mic", "usb");
    expect(selectRecorderDevice([input("usb", "USB Mic (1234:abcd)")], undefined, [usb]))
      .toEqual({ ok: true, deviceId: "usb" });
    expect(selectRecorderDevice([input("headset", "Headset (Bluetooth)")], undefined, [headset]))
      .toEqual({ ok: true, deviceId: "headset" });
  });

  it("prefers the default external physical input when there is no built-in", () => {
    const usb = native("usb", "USB Mic", "usb");
    const devices = [input("usb", "USB Mic (1234:abcd)"), input("headset", "Headset (Bluetooth)")];
    expect(selectRecorderDevice(devices, undefined, [usb, { ...headset, isDefault: true }]))
      .toEqual({ ok: true, deviceId: "headset" });
  });

  it("skips physical inputs Chromium does not expose during automatic selection", () => {
    const usb = native("usb", "USB Mic", "usb");
    const devices = [input("usb", "USB Mic (1234:abcd)")];
    expect(selectRecorderDevice(devices, undefined, [{ ...headset, isDefault: true }, usb]))
      .toEqual({ ok: true, deviceId: "usb" });
    expect(selectRecorderDevice(devices, undefined, [builtIn, usb])).toEqual({ ok: true, deviceId: "usb" });
    expect(selectRecorderDevice([input("virtual", "Background Music (Virtual)")], undefined,
      [headset, native("virtual-uid", "Background Music", "virtual", false)]))
      .toMatchObject({ ok: false });
  });

  it("skips an ambiguous ranked input for a uniquely identifiable physical one", () => {
    const usb = native("usb", "USB Mic", "usb");
    const devices = [input("one", "MacBook Pro Microphone (Built-in)"), input("two", "MacBook Pro Microphone (Built-in)"),
      input("usb", "USB Mic (1234:abcd)")];
    expect(selectRecorderDevice(devices, undefined, [builtIn, usb])).toEqual({ ok: true, deviceId: "usb" });
    expect(selectRecorderDevice(devices.slice(0, 2), undefined, [builtIn, usb])).toMatchObject({ ok: false });
  });

  it("rejects preferred browser IDs for virtual, unknown or ambiguous native devices", () => {
    expect(selectRecorderDevice([input("virtual", "Background Music (Virtual)")], "virtual",
      [native("virtual-native", "Background Music", "virtual", false)]))
      .toMatchObject({ ok: false });
    expect(selectRecorderDevice([input("unknown", "Unknown")], "unknown", [builtIn])).toMatchObject({ ok: false });
    expect(selectRecorderDevice([input("headset", "Headset (Bluetooth)")], "headset", [headset, { ...headset, uid: "other" }]))
      .toMatchObject({ ok: false });
  });

  it("uses transport-marked physical browser inputs without the native addon", () => {
    const devices = [input("virtual", "Background Music (Virtual)"), input("headset", "Headset (Bluetooth)"),
      input("built-in", "MacBook Pro Microphone (Built-in)")];
    expect(selectRecorderDevice(devices, undefined, [])).toEqual({ ok: true, deviceId: "built-in" });
    expect(selectRecorderDevice(devices, "headset", [])).toEqual({ ok: true, deviceId: "headset" });
    expect(selectRecorderDevice([input("usb", "USB Mic (1234:abcd)")], undefined, []))
      .toEqual({ ok: true, deviceId: "usb" });
  });

  it("rejects virtual, unnamed and unknown browser inputs without native metadata", () => {
    for (const label of ["Background Music (Virtual)", "Aggregate Device (Aggregate)", "BlackHole (Built-in)", "", "Unknown"]) {
      expect(selectRecorderDevice([input("unsafe", label)], "unsafe", [])).toMatchObject({ ok: false });
      expect(selectRecorderDevice([input("unsafe", label)], undefined, [])).toMatchObject({ ok: false });
    }
    const duplicates = [input("one", "MacBook Pro Microphone (Built-in)"), input("two", "MacBook Pro Microphone (Built-in)")];
    expect(selectRecorderDevice(duplicates, undefined, [])).toMatchObject({ ok: false });
    expect(selectRecorderDevice(duplicates, "one", [])).toMatchObject({ ok: false });
  });
});
