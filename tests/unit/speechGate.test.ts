import { describe, expect, it } from "vitest";
import { evaluateSpeechGate, isDigitallySilent } from "@main/audio/speechGate";
import { createWavBuffer, toPcm16 } from "@main/providers/shared/audioUtils";

// Frames plus samples. Digital silence is decided from the samples, so by default the frames stand in for them.
function gate(frames: number[], pcmData = frames) {
  return evaluateSpeechGate(frames, pcmData);
}

describe("isDigitallySilent", () => {
  it("treats a -0.5 step as silent because the encoder writes 0", () => {
    expect(toPcm16(-0.5 / 32767) === 0).toBe(true); // Math.round gives -0, which is still zero
    expect(isDigitallySilent([-0.5 / 32767])).toBe(true);
  });

  it("does not treat a +0.5 step as silent because the encoder rounds it up to 1", () => {
    expect(toPcm16(0.5 / 32767)).toBe(1);
    expect(isDigitallySilent([0.5 / 32767])).toBe(false);
  });

  it("does not treat samples that encode to plus or minus 1 as silent", () => {
    expect(isDigitallySilent([1 / 32767])).toBe(false);
    expect(isDigitallySilent([-1 / 32767])).toBe(false);
  });

  it("agrees with the WAV encoder on every sample it tests", () => {
    const samples = [0, 0.4 / 32767, -0.4 / 32767, 0.5 / 32767, -0.5 / 32767, 1 / 32767, -1 / 32767];
    for (const sample of samples) {
      const wav = createWavBuffer({ pcmData: [sample], sampleRate: 16_000, durationSeconds: 1 / 16_000, rmsFrames: [] });
      expect(isDigitallySilent([sample])).toBe(wav.readInt16LE(44) === 0);
    }
  });
});

describe("evaluateSpeechGate", () => {
  it("rejects empty frames as silent", () => {
    expect(evaluateSpeechGate([], [])).toMatchObject({
      pass: false,
      decision: "silent",
      reason: "no-frames",
    });
  });

  it("rejects digitally silent clips", () => {
    expect(gate(new Array(20).fill(0))).toMatchObject({
      pass: false,
      decision: "silent",
      reason: "digital-silence",
    });
  });

  it("sends nonzero audio below one 16-bit step on to transcription", () => {
    expect(gate(new Array(50).fill(0.00005))).toMatchObject({
      pass: true,
      decision: "uncertain",
      reason: "no-speech-contrast",
    });
  });

  it("rejects a clip whose every sample rounds to zero in 16-bit PCM", () => {
    expect(gate(new Array(50).fill(0.25 / 32768))).toMatchObject({
      pass: false,
      reason: "digital-silence",
    });
  });

  it("rejects a -0.5 step clip as digitally silent", () => {
    expect(gate(new Array(50).fill(-0.5 / 32767))).toMatchObject({
      pass: false,
      reason: "digital-silence",
    });
  });

  it("sends a clip with a single sample that encodes to 1 on to transcription", () => {
    const pcm = [...new Array(49).fill(0), 1 / 32767];

    expect(gate(new Array(50).fill(0), pcm)).toMatchObject({
      pass: true,
      reason: "no-speech-contrast",
    });
  });

  it("sends steady quiet audio on as uncertain instead of rejecting it", () => {
    expect(gate(new Array(20).fill(0.0002))).toMatchObject({
      pass: true,
      decision: "uncertain",
      reason: "no-speech-contrast",
      longestRunMs: 0,
      totalSpeechMs: 0,
    });
  });

  it("sends steady soft speech at 0.004 on as uncertain", () => {
    expect(gate(new Array(50).fill(0.004))).toMatchObject({
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

    expect(gate(frames)).toMatchObject({
      pass: true,
      decision: "speech",
      reason: "speech",
      longestRunMs: 160,
      totalSpeechMs: 160,
    });
  });

  it("passes loud-throughout clips as speech-dominant", () => {
    const result = gate(new Array(20).fill(0.02));

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

    expect(gate(frames)).toMatchObject({
      pass: true,
      decision: "uncertain",
      reason: "no-speech-contrast",
    });
  });
});
