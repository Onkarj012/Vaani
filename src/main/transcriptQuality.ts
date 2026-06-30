import type { AudioClip, TranscriptQualityDecision, TranscriptionQualityMetadata } from "@shared/types";

const COMMON_NO_SPEECH_TRANSCRIPTS = new Set([
  "bye",
  "goodbye",
  "ok",
  "okay",
  "sorry",
  "thank you",
  "thanks",
  "thanks bye",
  "thanks for watching",
  "thank you for watching",
  "thanks for watching this video",
]);

export function decideTranscriptInsertion(
  rawText: string,
  clip: Pick<AudioClip, "rmsFrames">,
  quality?: TranscriptionQualityMetadata,
): TranscriptQualityDecision {
  const text = rawText.trim();
  if (!text) return { action: "reject", reason: "empty-transcript" };

  const tokens = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)?/gu) ?? [];
  const compact = tokens.join("");
  if (!compact) return { action: "reject", reason: "empty-transcript" };

  const normalized = tokens.join(" ").toLowerCase();
  const lowSpeechAudio = looksLikeLowSpeechAudio(clip);
  const lowConfidence = hasLowProviderConfidence(quality);

  if (COMMON_NO_SPEECH_TRANSCRIPTS.has(normalized) && (lowSpeechAudio || lowConfidence)) {
    return { action: "retry", reason: "common-silence-hallucination" };
  }

  if (quality?.noSpeechProbability != null && quality.noSpeechProbability >= 0.6) {
    return { action: "retry", reason: "provider-no-speech-probability" };
  }

  if (quality?.confidence != null && quality.confidence < 0.35) {
    return { action: "retry", reason: "provider-low-confidence" };
  }

  if (quality?.avgLogprob != null && quality.avgLogprob < -1.2 && tokens.length <= 4) {
    return { action: "retry", reason: "provider-low-logprob" };
  }

  if (compact.length === 1 && !/^[ai]$/i.test(compact)) {
    return { action: "reject", reason: "single-letter-fragment" };
  }

  if (lowSpeechAudio && tokens.length <= 2 && compact.length <= 8) {
    return { action: "retry", reason: "quiet-short-fragment" };
  }

  return { action: "insert", reason: "passed" };
}

export function finalizeTranscriptDecision(decision: TranscriptQualityDecision): TranscriptQualityDecision {
  if (decision.action !== "retry") return decision;
  return { action: "save", reason: decision.reason };
}

function hasLowProviderConfidence(quality: TranscriptionQualityMetadata | undefined): boolean {
  if (!quality) return false;
  return (quality.confidence != null && quality.confidence < 0.35)
    || (quality.noSpeechProbability != null && quality.noSpeechProbability >= 0.6)
    || (quality.avgLogprob != null && quality.avgLogprob < -1.2);
}

function looksLikeLowSpeechAudio(clip: Pick<AudioClip, "rmsFrames">): boolean {
  if (clip.rmsFrames.length === 0) return true;
  const maxRms = Math.max(...clip.rmsFrames);
  const avgRms = clip.rmsFrames.reduce((sum, value) => sum + value, 0) / clip.rmsFrames.length;
  return maxRms < 0.002 || (maxRms < 0.0035 && avgRms < 0.0015);
}
