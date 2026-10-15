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

// Every sample and every frame at one amplitude, so the clip's peak and RMS both equal it.
function constantClip(amplitude: number, frameCount: number): AudioClip {
  const pcmData = new Array(frameCount * SAMPLES_PER_FRAME).fill(amplitude);
  return {
    pcmData,
    sampleRate: SAMPLE_RATE,
    durationSeconds: pcmData.length / SAMPLE_RATE,
    rmsFrames: new Array(frameCount).fill(amplitude),
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

  it("keeps nonzero audio below the energy floor untrimmed", () => {
    const clip = clipFromRmsFrames(Array(20).fill(0.0005));

    const trimmed = trimSilence(clip, 0.005);

    expect(trimmed.rmsFrames).toHaveLength(20);
    expect(trimmed.pcmData.length).toBeGreaterThan(0);
  });

  it("empties digitally silent audio", () => {
    const trimmed = trimSilence(constantClip(0, 20), 0.005);

    expect(trimmed.pcmData).toHaveLength(0);
    expect(trimmed.durationSeconds).toBe(0);
  });

  it("keeps audio whose samples survive 16-bit quantization", () => {
    const clip = constantClip(0.00005, 20);

    const trimmed = trimSilence(clip, 0.005);

    expect(trimmed.pcmData).toHaveLength(clip.pcmData.length);
    expect(trimmed.rmsFrames).toHaveLength(20);
  });

  it("empties audio whose samples all round to zero in 16-bit PCM", () => {
    const trimmed = trimSilence(constantClip(0.4 / 32768, 20), 0.005);

    expect(trimmed.pcmData).toHaveLength(0);
  });

  it("empties a clip of -0.5 steps, which the encoder writes as zero", () => {
    const trimmed = trimSilence(constantClip(-0.5 / 32767, 20), 0.005);

    expect(trimmed.pcmData).toHaveLength(0);
  });

  it("keeps a clip whose samples encode to 1 in 16-bit PCM", () => {
    const clip = constantClip(1 / 32767, 20);

    const trimmed = trimSilence(clip, 0.005);

    expect(trimmed.pcmData).toHaveLength(clip.pcmData.length);
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
