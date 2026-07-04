import type { AudioClip } from "./types";

export const TARGET_SAMPLE_RATE = 16_000;
export const PRE_ROLL_MS = 2_000;
export const PRE_ROLL_SILENCE_THRESHOLD = 0.0015;

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

export function trimLeadingSilence(input: Float32Array, sampleRate: number, threshold = PRE_ROLL_SILENCE_THRESHOLD): Float32Array {
  const frameSize = Math.max(1, Math.floor(sampleRate * 0.02));
  let firstSpeechSample = input.length;

  for (let offset = 0; offset < input.length; offset += frameSize) {
    const frame = input.subarray(offset, Math.min(offset + frameSize, input.length));
    if (calculateRms(frame) >= threshold) {
      firstSpeechSample = offset;
      break;
    }
  }

  if (firstSpeechSample >= input.length) {
    return new Float32Array();
  }

  return input.slice(firstSpeechSample);
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

const NORMALIZE_PEAK_BELOW = 0.1;
const NORMALIZE_SILENCE_PEAK = 0.001;
const NORMALIZE_SILENCE_EPSILON = 1e-9;
const NORMALIZE_TARGET_PEAK = 0.3;
const NORMALIZE_MAX_GAIN = 20;

// Gentle peak normalization for quiet-but-real speech so STT gets a usable
// level. Near-silence is left untouched — boosting it would only feed noise to
// Whisper and defeat the silence gates.
export function normalizeQuietPcm(input: Float32Array): Float32Array {
  let peak = 0;
  for (let index = 0; index < input.length; index += 1) {
    peak = Math.max(peak, Math.abs(input[index] ?? 0));
  }
  if (peak >= NORMALIZE_PEAK_BELOW || peak <= NORMALIZE_SILENCE_PEAK + NORMALIZE_SILENCE_EPSILON) return input;

  const gain = Math.min(NORMALIZE_MAX_GAIN, NORMALIZE_TARGET_PEAK / peak);
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    output[index] = (input[index] ?? 0) * gain;
  }
  return output;
}

export function pcmToAudioClip(input: Float32Array, inputRate: number): AudioClip {
  const pcmData = resampleToTargetRate(input, inputRate, TARGET_SAMPLE_RATE);
  // rmsFrames reflect the true acoustic levels (pre-normalization) so the
  // speech gate and VAD judge what the mic actually heard; only the samples
  // sent to STT are boosted.
  const rmsFrames = calculateRmsFrames(pcmData, TARGET_SAMPLE_RATE);
  const normalized = normalizeQuietPcm(pcmData);
  return {
    pcmData: Array.from(normalized),
    sampleRate: TARGET_SAMPLE_RATE,
    durationSeconds: pcmData.length / TARGET_SAMPLE_RATE,
    rmsFrames,
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
