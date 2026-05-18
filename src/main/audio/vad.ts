import type { AudioClip } from "@shared/types";
import { debug } from "@main/log";

const LEADING_PAD_FRAMES = 12;
const TRAILING_PAD_FRAMES = 50;

export function trimSilence(clip: AudioClip, threshold: number): AudioClip {
  const maxRms = clip.rmsFrames.length > 0 ? Math.max(...clip.rmsFrames) : 0;
  const avgRms = clip.rmsFrames.length > 0 ? clip.rmsFrames.reduce((a, b) => a + b, 0) / clip.rmsFrames.length : 0;

  let effectiveThreshold = threshold;
  let startIndex = clip.rmsFrames.findIndex(v => v >= effectiveThreshold);
  let endIndex = clip.rmsFrames.findLastIndex(v => v >= effectiveThreshold);

  // If no frames pass the threshold but there IS audio data, use adaptive threshold
  // This handles quiet microphones or low-gain audio
  if ((startIndex === -1 || endIndex === -1) && maxRms > 0.001 && clip.pcmData.length > 0) {
    // Use 30% of max RMS as threshold, with a floor of 0.002
    effectiveThreshold = Math.max(0.002, maxRms * 0.3);
    startIndex = clip.rmsFrames.findIndex(v => v >= effectiveThreshold);
    endIndex = clip.rmsFrames.findLastIndex(v => v >= effectiveThreshold);
    debug("vad", `Adaptive threshold: ${effectiveThreshold.toFixed(4)} (original ${threshold.toFixed(4)} too high)`);
  }

  debug("vad", `trimSilence: threshold=${effectiveThreshold.toFixed(4)}, maxRms=${maxRms.toFixed(4)}, avgRms=${avgRms.toFixed(4)}, frames=${clip.rmsFrames.length}, startIdx=${startIndex}, endIdx=${endIndex}`);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    debug("vad", "ALL frames below threshold! Clip treated as silence.");
    return { ...clip, pcmData: [], durationSeconds: 0, rmsFrames: [] };
  }

  const paddedStart = Math.max(0, startIndex - LEADING_PAD_FRAMES);
  const paddedEnd = Math.min(clip.rmsFrames.length - 1, endIndex + TRAILING_PAD_FRAMES);
  const spf = Math.max(1, Math.floor(clip.pcmData.length / Math.max(clip.rmsFrames.length, 1)));
  const startSample = paddedStart * spf;
  const endSample = Math.min(clip.pcmData.length, (paddedEnd + 1) * spf);
  const trimmed = clip.pcmData.slice(startSample, endSample);

  return {
    ...clip,
    pcmData: trimmed,
    rmsFrames: clip.rmsFrames.slice(paddedStart, paddedEnd + 1),
    durationSeconds: trimmed.length / clip.sampleRate
  };
}

export function isValidClip(clip: AudioClip, minDuration: number): boolean {
  return clip.durationSeconds >= minDuration && clip.pcmData.length > 0;
}
