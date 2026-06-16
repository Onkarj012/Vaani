import { describe, expect, it } from "vitest";
import { createWavBuffer } from "@main/providers/shared/audioUtils";

describe("STT audio utils", () => {
  it("creates a mono 16-bit PCM WAV buffer with expected headers", () => {
    const wav = createWavBuffer({
      pcmData: [1, -1, 0],
      sampleRate: 16_000,
      durationSeconds: 0.0001875,
      rmsFrames: [],
    });

    expect(wav.length).toBe(44 + 3 * 2);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readInt16LE(44)).toBe(32767);
    expect(wav.readInt16LE(46)).toBe(-32767);
    expect(wav.readInt16LE(48)).toBe(0);
  });

  it("clamps out-of-range samples before encoding", () => {
    const wav = createWavBuffer({
      pcmData: [2, -2],
      sampleRate: 16_000,
      durationSeconds: 0.000125,
      rmsFrames: [],
    });

    expect(wav.readInt16LE(44)).toBe(32767);
    expect(wav.readInt16LE(46)).toBe(-32767);
  });
});
