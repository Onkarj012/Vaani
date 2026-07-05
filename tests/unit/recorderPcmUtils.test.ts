import { describe, expect, it } from "vitest";
import { PcmRingBuffer, normalizeQuietPcm, pcmToAudioClip, resampleToTargetRate, trimLeadingSilence } from "@shared/pcmUtils";

describe("PcmRingBuffer", () => {
  it("keeps the newest samples in order", () => {
    const ring = new PcmRingBuffer(5);

    ring.append(new Float32Array([1, 2, 3]));
    ring.append(new Float32Array([4, 5, 6, 7]));

    expect(Array.from(ring.snapshot())).toEqual([3, 4, 5, 6, 7]);
    expect(Array.from(ring.snapshot(3))).toEqual([5, 6, 7]);
  });

  it("clears buffered samples", () => {
    const ring = new PcmRingBuffer(3);
    ring.append(new Float32Array([1, 2, 3]));

    ring.clear();

    expect(Array.from(ring.snapshot())).toEqual([]);
  });
});

describe("trimLeadingSilence", () => {
  it("drops leading silent pre-roll but keeps speech and trailing samples", () => {
    const sampleRate = 1_000;
    const silent = new Float32Array(40).fill(0);
    const speech = new Float32Array(80).fill(0.02);
    const combined = new Float32Array([...silent, ...speech]);

    const trimmed = trimLeadingSilence(combined, sampleRate, 0.0015);

    expect(trimmed.length).toBe(80);
    expect(trimmed[0]).toBeCloseTo(0.02);
  });

  it("returns an empty buffer for pure silence", () => {
    const trimmed = trimLeadingSilence(new Float32Array(100).fill(0), 1_000, 0.0015);

    expect(trimmed.length).toBe(0);
  });
});

describe("pcmToAudioClip", () => {
  it("resamples to the target clip format", () => {
    const input = new Float32Array(48_000).fill(0.1);
    const clip = pcmToAudioClip(input, 48_000);

    expect(clip.sampleRate).toBe(16_000);
    expect(clip.pcmData).toHaveLength(16_000);
    expect(clip.durationSeconds).toBe(1);
    expect(clip.rmsFrames.length).toBeGreaterThan(0);
  });

  it("handles empty resample input", () => {
    expect(resampleToTargetRate(new Float32Array(), 48_000, 16_000)).toHaveLength(0);
  });

  it("computes rms frames from pre-normalization samples", () => {
    const input = new Float32Array(320).fill(0.03);
    const clip = pcmToAudioClip(input, 16_000);

    expect(Math.max(...clip.pcmData)).toBeCloseTo(0.3);
    expect(clip.rmsFrames[0]).toBeCloseTo(0.03);
  });
});

describe("normalizeQuietPcm", () => {
  it("boosts quiet speech toward the target peak", () => {
    const normalized = normalizeQuietPcm(new Float32Array([0.03, -0.015]));

    expect(normalized[0]).toBeCloseTo(0.3);
    expect(normalized[1]).toBeCloseTo(-0.15);
  });

  it("caps quiet speech boost at 20x", () => {
    const normalized = normalizeQuietPcm(new Float32Array([0.005]));

    expect(normalized[0]).toBeCloseTo(0.1);
  });

  it("leaves near-silence untouched", () => {
    const input = new Float32Array([0.001, -0.0005]);

    expect(normalizeQuietPcm(input)).toBe(input);
  });

  it("leaves normal levels untouched", () => {
    const input = new Float32Array([0.1, -0.05]);

    expect(normalizeQuietPcm(input)).toBe(input);
  });
});
