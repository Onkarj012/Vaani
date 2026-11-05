import { describe, expect, it } from "vitest";
import { waveformHeight } from "@renderer/recorder/waveform";

describe("waveform amplitude", () => {
  it("keeps silence and input below -54 dB at the visual floor", () => {
    expect(waveformHeight(0)).toBe(0.12);
    expect(waveformHeight(0.001)).toBe(0.12);
  });
  it("makes louder input taller without a per-chunk reference", () => {
    expect(waveformHeight(0.01)).toBeLessThan(waveformHeight(0.1));
    expect(waveformHeight(0.1)).toBeLessThan(waveformHeight(0.4));
  });
  it("saturates at -6 dB and stays within the visual ceiling", () => {
    expect(waveformHeight(10 ** (-6 / 20))).toBe(1);
    expect(waveformHeight(1)).toBe(1);
  });
});
