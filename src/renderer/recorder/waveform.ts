// Map absolute sample amplitude to the fixed visual loudness range.
export function waveformHeight(amplitude: number): number {
  const decibels = 20 * Math.log10(Math.max(amplitude, 1e-9));
  const level = Math.max(0, Math.min(1, (decibels + 54) / 48));
  return 0.12 + level * 0.88;
}
