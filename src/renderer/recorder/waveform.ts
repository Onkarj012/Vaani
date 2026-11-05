import { levelFromRms } from "@shared/audioLevel";

// Map absolute sample amplitude to the fixed visual loudness range.
export function waveformHeight(amplitude: number): number {
  return 0.12 + levelFromRms(amplitude) * 0.88;
}
