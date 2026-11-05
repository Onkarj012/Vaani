// Fixed loudness scale shared by every recorder path and the overlay waveform.
export const LEVEL_FLOOR_DB = -54;
export const LEVEL_FULL_SCALE_DB = -6;

// Maps an RMS or peak amplitude to 0-1 on the fixed -54 to -6 dB scale. Same input, same output.
export function levelFromRms(rms: number): number {
  const db = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
  return Math.max(0, Math.min(1, (db - LEVEL_FLOOR_DB) / (LEVEL_FULL_SCALE_DB - LEVEL_FLOOR_DB)));
}

// RMS of one chunk of float samples.
export function chunkRms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}
