import type { AudioClip } from "./types";
import { quietSpeechGain } from "./quietSpeechGain";

export const TARGET_SAMPLE_RATE = 16_000;
export const PRE_ROLL_MS = 2_000;
export const PRE_ROLL_SILENCE_THRESHOLD = 0.0015;
// Audio kept before the detected onset, so a soft opening sound is not clipped.
export const PRE_ROLL_LEAD_PAD_MS = 250;

export class PcmRingBuffer {
  private readonly samples: Float32Array;
  private writeIndex = 0;
  private sampleCount = 0;

  constructor(capacitySamples: number) {
    this.samples = new Float32Array(Math.max(1, capacitySamples));
  }

  get capacity(): number {
    return this.samples.length;
  }

  append(input: Float32Array): void {
    for (let index = 0; index < input.length; index += 1) {
      this.samples[this.writeIndex] = input[index] ?? 0;
      this.writeIndex = (this.writeIndex + 1) % this.samples.length;
      this.sampleCount = Math.min(this.sampleCount + 1, this.samples.length);
    }
  }

  snapshot(maxSamples = this.sampleCount): Float32Array {
    const count = Math.min(Math.max(0, maxSamples), this.sampleCount);
    const output = new Float32Array(count);
    const start = (this.writeIndex - count + this.samples.length) % this.samples.length;
    for (let index = 0; index < count; index += 1) {
      output[index] = this.samples[(start + index) % this.samples.length] ?? 0;
    }
    return output;
  }

  clear(): void {
    this.samples.fill(0);
    this.writeIndex = 0;
    this.sampleCount = 0;
  }
}

// Drops silence before the first speech frame, keeping a lead pad. Keeps the whole input when no speech is found.
export function trimLeadingSilence(input: Float32Array, sampleRate: number, threshold = PRE_ROLL_SILENCE_THRESHOLD): Float32Array {
  const frameSize = Math.max(1, Math.floor(sampleRate * 0.02));
  const leadPadSamples = Math.floor(sampleRate * PRE_ROLL_LEAD_PAD_MS / 1000);

  for (let offset = 0; offset < input.length; offset += frameSize) {
    const frame = input.subarray(offset, Math.min(offset + frameSize, input.length));
    if (calculateRms(frame) >= threshold) {
      return input.slice(Math.max(0, offset - leadPadSamples));
    }
  }

  return input;
}

export function mergePcmChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function resampleToTargetRate(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) {
    return input;
  }

  if (input.length === 0) {
    return new Float32Array();
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  if (ratio > 1) {
    for (let index = 0; index < outputLength; index += 1) {
      const start = Math.floor(index * ratio);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
      let sum = 0;
      for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
        sum += input[sourceIndex] ?? 0;
      }
      output[index] = sum / (end - start);
    }
    return output;
  }

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, input.length - 1);
    const interpolation = sourceIndex - left;
    output[index] = (input[left] ?? 0) * (1 - interpolation) + (input[right] ?? 0) * interpolation;
  }

  return output;
}

export function calculateRmsFrames(pcmData: Float32Array, sampleRate: number): number[] {
  const frameSize = Math.max(1, Math.floor(sampleRate * 0.02));
  const rmsFrames: number[] = [];

  for (let index = 0; index < pcmData.length; index += frameSize) {
    const frame = pcmData.subarray(index, Math.min(index + frameSize, pcmData.length));
    if (frame.length === 0) continue;
    rmsFrames.push(calculateRms(frame));
  }

  return rmsFrames;
}

// Lifts quiet or whispered speech to a usable level for STT. Near-silence and
// room noise are left untouched, since boosting them only feeds Whisper noise.
export function normalizeQuietPcm(input: Float32Array): Float32Array {
  const gain = quietSpeechGain(input);
  return gain === 1 ? input : scalePcm(input, gain);
}

// Multiplies every sample by gain, clipped to [-1, 1].
function scalePcm(input: Float32Array, gain: number): Float32Array {
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    output[index] = Math.max(-1, Math.min(1, (input[index] ?? 0) * gain));
  }
  return output;
}

export function pcmToAudioClip(input: Float32Array, inputRate: number): AudioClip {
  const resampled = resampleToTargetRate(input, inputRate, TARGET_SAMPLE_RATE);
  const gain = quietSpeechGain(resampled);
  // Frame levels come from the boosted samples, so the gate and trim judge exactly what STT receives.
  const pcmData = gain === 1 ? resampled : scalePcm(resampled, gain);
  return {
    pcmData: Array.from(pcmData),
    sampleRate: TARGET_SAMPLE_RATE,
    durationSeconds: resampled.length / TARGET_SAMPLE_RATE,
    rmsFrames: calculateRmsFrames(pcmData, TARGET_SAMPLE_RATE),
    gain,
  };
}

function calculateRms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const sample = frame[index] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / frame.length);
}
