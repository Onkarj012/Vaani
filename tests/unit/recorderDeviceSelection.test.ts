import { describe, expect, it } from "vitest";
import { selectRecorderDeviceId, type AudioInputLike } from "@renderer/recorder/deviceSelection";

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

  it("never selects BlackHole", () => {
    const devices = [input("vd", "BlackHole 2ch"), input("ext", "USB Microphone")];
    expect(selectRecorderDeviceId(devices)).toBe("ext");
  });

  it("never selects Loopback Audio", () => {
    const devices = [input("vd", "Loopback Audio"), input("ext", "Yeti Stereo Microphone")];
    expect(selectRecorderDeviceId(devices)).toBe("ext");
  });

  it("picks the first physical input when no built-in mic exists", () => {
    const devices = [
      input("agg", "Aggregate Device"),
      input("ext1", "USB Microphone"),
      input("ext2", "Scarlett 2i2"),
    ];
    expect(selectRecorderDeviceId(devices)).toBe("ext1");
  });

  it("returns undefined when only virtual inputs exist", () => {
    const devices = [input("vd", "BlackHole 16ch"), input("lb", "Loopback Audio")];
    expect(selectRecorderDeviceId(devices)).toBeUndefined();
  });

  it("ignores default and communications pseudo-devices", () => {
    const devices = [
      input("default", "Default"),
      input("communications", "Communications"),
      input("bi", "Built-in Microphone"),
    ];
    expect(selectRecorderDeviceId(devices)).toBe("bi");
  });

  it("does not crash on empty labels and treats them as physical", () => {
    const devices = [input("x", "")];
    expect(selectRecorderDeviceId(devices)).toBe("x");
  });

  it("excludes non-audioinput devices", () => {
    const devices: AudioInputLike[] = [
      { kind: "audiooutput", deviceId: "spk", label: "Speakers" },
      input("bi", "Built-in Microphone"),
    ];
    expect(selectRecorderDeviceId(devices)).toBe("bi");
  });
});
