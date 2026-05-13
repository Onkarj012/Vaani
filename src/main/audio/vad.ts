import type { AudioClip } from "@shared/types";

const LEADING_PAD_FRAMES = 12;
const TRAILING_PAD_FRAMES = 35;

export function trimSilence(clip: AudioClip, threshold: number): AudioClip {
  const startIndex = clip.rmsFrames.findIndex(v => v >= threshold);
  const endIndex = clip.rmsFrames.findLastIndex(v => v >= threshold);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
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
