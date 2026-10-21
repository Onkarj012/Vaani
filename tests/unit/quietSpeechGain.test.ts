import { describe, expect, it } from "vitest";
import { normalizeQuietPcm } from "@shared/pcmUtils";
import { quietSpeechGain } from "@shared/quietSpeechGain";

const SAMPLE_RATE = 16_000;

function sine(peak: number, seconds = 0.5): Float32Array {
  const samples = new Float32Array(SAMPLE_RATE * seconds);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = peak * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE);
  }
  return samples;
}

// Deterministic uniform noise in [-amplitude, amplitude].
function noise(amplitude: number, count = SAMPLE_RATE / 2): Float32Array {
  const samples = new Float32Array(count);
  let seed = 1;
  for (let index = 0; index < count; index += 1) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    samples[index] = amplitude * ((seed / 4294967296) * 2 - 1);
  }
  return samples;
}

function peakOf(samples: Float32Array): number {
  return samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
}

describe("quiet speech gain", () => {
  it("boosts a whispered sine so its peak reaches about 0.7", () => {
    const input = sine(0.09);
    const result = { gain: quietSpeechGain(input), samples: normalizeQuietPcm(input) };

    expect(result.gain).toBeCloseTo(0.7 / peakOf(input), 6);
    expect(peakOf(result.samples)).toBeCloseTo(0.7, 2);
  });

  it("caps the boost at 20x for very quiet speech", () => {
    const result = { gain: quietSpeechGain(sine(0.02)), samples: normalizeQuietPcm(sine(0.02)) };

    expect(result.gain).toBe(20);
    expect(peakOf(result.samples)).toBeCloseTo(0.4, 2);
  });

  it("leaves loud clips untouched", () => {
    const input = sine(0.5);
    const result = { gain: quietSpeechGain(input), samples: normalizeQuietPcm(input) };

    expect(result.gain).toBe(1);
    expect(result.samples).toBe(input);
  });

  it("leaves near-silent noise untouched", () => {
    const input = noise(0.002);
    const result = { gain: quietSpeechGain(input), samples: normalizeQuietPcm(input) };

    expect(result.gain).toBe(1);
    expect(result.samples).toBe(input);
  });

  it("keeps every boosted sample inside [-1, 1]", () => {
    const result = { gain: quietSpeechGain(sine(0.24)), samples: normalizeQuietPcm(sine(0.24)) };

    expect(peakOf(result.samples)).toBeLessThanOrEqual(1);
    expect(peakOf(result.samples)).toBeCloseTo(0.7, 2);
  });

  it("boosts a short whisper after long near-silent pre-roll", () => {
    const input = new Float32Array([...noise(0.00175, SAMPLE_RATE * 2), ...sine(0.0042)]);

    expect(quietSpeechGain(input)).toBe(20);
  });
});
