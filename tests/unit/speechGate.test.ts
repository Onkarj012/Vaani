import { describe, expect, it } from "vitest";
import { evaluateSpeechGate } from "@main/audio/speechGate";

describe("evaluateSpeechGate", () => {
  it("rejects empty frames as silent", () => {
    expect(evaluateSpeechGate([])).toMatchObject({
      pass: false,
      decision: "silent",
      reason: "no-frames",
    });
  });

  it("rejects digitally silent frames", () => {
    expect(evaluateSpeechGate(new Array(20).fill(0))).toMatchObject({
      pass: false,
      decision: "silent",
      reason: "digital-silence",
    });
  });

  it("sends steady quiet audio on as uncertain instead of rejecting it", () => {
    expect(evaluateSpeechGate(new Array(20).fill(0.0002))).toMatchObject({
      pass: true,
      decision: "uncertain",
      reason: "no-speech-contrast",
      longestRunMs: 0,
      totalSpeechMs: 0,
    });
  });

  it("sends steady soft speech at 0.004 on as uncertain", () => {
    expect(evaluateSpeechGate(new Array(50).fill(0.004))).toMatchObject({
      pass: true,
      decision: "uncertain",
      reason: "no-speech-contrast",
    });
  });

  it("passes a clear speech burst as speech", () => {
    const frames = [
      ...new Array(5).fill(0.0002),
      ...new Array(8).fill(0.006),
      ...new Array(5).fill(0.0002),
    ];

    expect(evaluateSpeechGate(frames)).toMatchObject({
      pass: true,
      decision: "speech",
      reason: "speech",
      longestRunMs: 160,
      totalSpeechMs: 160,
    });
  });

  it("passes loud-throughout clips as speech-dominant", () => {
    const result = evaluateSpeechGate(new Array(20).fill(0.02));

    expect(result.pass).toBe(true);
    expect(result.decision).toBe("speech");
    expect(result.reason).toBe("speech-dominant");
    expect(result.noiseFloor).toBeGreaterThanOrEqual(0.008);
  });

  it("marks brief 40ms blips as uncertain rather than speech", () => {
    const frames = [
      ...new Array(5).fill(0.0002),
      ...new Array(2).fill(0.006),
      ...new Array(5).fill(0.0002),
    ];

    expect(evaluateSpeechGate(frames)).toMatchObject({
      pass: true,
      decision: "uncertain",
      reason: "no-speech-contrast",
    });
  });
});
