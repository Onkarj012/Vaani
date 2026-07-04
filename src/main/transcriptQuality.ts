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

// Whisper emits these on silent/noise-only audio regardless of the user's
// language — they come from subtitle/outro training data. Matched as
// substrings of the normalized transcript.
const HALLUCINATION_SUBSTRINGS = [
  "ご視聴ありがとうございました",
  "ご視聴ありがとうございます",
  "チャンネル登録",
  "thanks for watching",
  "thank you for watching",
  "字幕by",
  "субтитры",
  "구독과 좋아요",
  "시청해주셔서 감사합니다",
  "mbc 뉴스",
  "www.mooji.org",
  "amara.org",
];

// Retry reasons that indicate the audio likely contained no real speech.
// When retries are exhausted these must never be inserted at the cursor.
const NO_SPEECH_REASONS = new Set([
  "common-silence-hallucination",
  "known-hallucination-phrase",
  "provider-no-speech-probability",
  "script-mismatch-quiet-audio",
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

  if (HALLUCINATION_SUBSTRINGS.some((phrase) => normalized.includes(phrase.toLowerCase()))) {
    return { action: "retry", reason: "known-hallucination-phrase" };
  }

  if (COMMON_NO_SPEECH_TRANSCRIPTS.has(normalized) && (lowSpeechAudio || lowConfidence)) {
    return { action: "retry", reason: "common-silence-hallucination" };
  }

  if (quality?.noSpeechProbability != null && quality.noSpeechProbability >= 0.6) {
    return { action: "retry", reason: "provider-no-speech-probability" };
  }

  if (lowSpeechAudio && isPredominantlyNonLatin(text)) {
    return { action: "retry", reason: "script-mismatch-quiet-audio" };
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

// On retry exhaustion: likely-non-speech results are saved to history only —
// inserting a hallucination into the user's document is worse than a miss.
// Genuine low-confidence speech is inserted; the user said something.
export function finalizeTranscriptDecision(decision: TranscriptQualityDecision): TranscriptQualityDecision {
  if (decision.action !== "retry") return decision;
  if (NO_SPEECH_REASONS.has(decision.reason)) {
    return { action: "save", reason: decision.reason };
  }
  return { action: "insert", reason: decision.reason };
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

function isPredominantlyNonLatin(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;
  const nonLatin = letters.filter((ch) => !/[\p{Script=Latin}]/u.test(ch)).length;
  return nonLatin / letters.length > 0.5;
}
