import { describe, expect, it } from "vitest";
import { trimSilence } from "@main/audio/vad";
import type { AudioClip } from "@shared/types";

const SAMPLE_RATE = 16_000;
const SAMPLES_PER_FRAME = 320;

function clipFromRmsFrames(rmsFrames: number[]): AudioClip {
  const pcmData = rmsFrames.flatMap((_rms, frameIndex) => Array(SAMPLES_PER_FRAME).fill(frameIndex));
  return {
    pcmData,
    sampleRate: SAMPLE_RATE,
    durationSeconds: pcmData.length / SAMPLE_RATE,
    rmsFrames,
  };
}

describe("trimSilence", () => {
  it("keeps energetic audio when all frames are below the configured threshold", () => {
    const clip = clipFromRmsFrames(Array(20).fill(0.004));

    const trimmed = trimSilence(clip, 0.005);

    expect(trimmed.rmsFrames).toHaveLength(20);
    expect(trimmed.pcmData.length).toBeGreaterThan(0);
    expect(trimmed.durationSeconds).toBeGreaterThan(0);
  });

  it("keeps low-gain energetic audio below the adaptive threshold floor", () => {
    const clip = clipFromRmsFrames(Array(20).fill(0.0015));

    const trimmed = trimSilence(clip, 0.005);

    expect(trimmed.rmsFrames).toHaveLength(20);
    expect(trimmed.pcmData.length).toBeGreaterThan(0);
  });

  it("keeps quiet opening and closing words around louder speech", () => {
    const leadingSilence = Array(60).fill(0.001);
    const quietOpeningWord = Array(8).fill(0.003);
    const loudMiddle = Array(10).fill(0.02);
    const quietClosingWord = Array(8).fill(0.003);
    const trailingSilence = Array(60).fill(0.001);
    const clip = clipFromRmsFrames([
      ...leadingSilence,
      ...quietOpeningWord,
      ...loudMiddle,
      ...quietClosingWord,
      ...trailingSilence,
    ]);

    const trimmed = trimSilence(clip, 0.005);
    const firstKeptFrame = trimmed.pcmData[0];
    const lastKeptFrame = trimmed.pcmData[trimmed.pcmData.length - 1];

    expect(firstKeptFrame).toBeLessThanOrEqual(leadingSilence.length);
    expect(lastKeptFrame).toBeGreaterThanOrEqual(
      leadingSilence.length + quietOpeningWord.length + loudMiddle.length + quietClosingWord.length - 1,
    );
  });
});
