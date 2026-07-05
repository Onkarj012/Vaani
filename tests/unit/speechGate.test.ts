import { describe, expect, it } from "vitest";
import { evaluateSpeechGate } from "@main/audio/speechGate";

describe("evaluateSpeechGate", () => {
  it("fails empty frames", () => {
    expect(evaluateSpeechGate([])).toMatchObject({
      pass: false,
      reason: "no-frames",
    });
  });

  it("fails silence-only frames", () => {
    expect(evaluateSpeechGate(new Array(20).fill(0.0002))).toMatchObject({
      pass: false,
      reason: "no-speech-contrast",
      longestRunMs: 0,
      totalSpeechMs: 0,
    });
  });

  it("passes a clear speech burst", () => {
    const frames = [
      ...new Array(5).fill(0.0002),
      ...new Array(8).fill(0.006),
      ...new Array(5).fill(0.0002),
    ];

    expect(evaluateSpeechGate(frames)).toMatchObject({
      pass: true,
      reason: "speech",
      longestRunMs: 160,
      totalSpeechMs: 160,
    });
  });

  it("passes loud-throughout clips as speech-dominant", () => {
    const result = evaluateSpeechGate(new Array(20).fill(0.02));

    expect(result.pass).toBe(true);
    expect(result.reason).toBe("speech-dominant");
    expect(result.noiseFloor).toBeGreaterThanOrEqual(0.008);
  });

  it("fails brief 40ms blips", () => {
    const frames = [
      ...new Array(5).fill(0.0002),
      ...new Array(2).fill(0.006),
      ...new Array(5).fill(0.0002),
    ];

    expect(evaluateSpeechGate(frames)).toMatchObject({
      pass: false,
      reason: "no-speech-contrast",
    });
  });
});
