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
// Whisper's average log-probability below which a two-term hint echo counts as unclear audio.
const HINT_ECHO_LOGPROB = -0.5;

const NO_SPEECH_REASONS = new Set([
  "common-silence-hallucination",
  "known-hallucination-phrase",
  "provider-no-speech-probability",
  "script-mismatch-quiet-audio",
  "vocabulary-hint-echo",
]);

// Decides whether a transcript may be inserted. hints are the dictionary words sent to the provider with the clip.
export function decideTranscriptInsertion(
  rawText: string,
  clip: Pick<AudioClip, "rmsFrames">,
  quality?: TranscriptionQualityMetadata,
  hints: readonly string[] = [],
): TranscriptQualityDecision {
  const text = rawText.trim();
  if (!text) return { action: "reject", reason: "empty-transcript" };

  const tokens = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)?/gu) ?? [];
  const compact = tokens.join("");
  if (!compact) return { action: "reject", reason: "empty-transcript" };

  const normalized = tokens.join(" ").toLowerCase();
  const lowSpeechAudio = looksLikeLowSpeechAudio(clip);
  const lowConfidence = hasLowProviderConfidence(quality);
  // On unclear audio Whisper can return the hint list it was given ("Onkar, CLAUDE.md, Unslop") instead of the speech.
  // Three or more terms is an echo. Two need a sign the audio was unclear, so a clear "Onkar Jadhav" still inserts.
  const hintTermCount = hintEchoTermCount(tokens, hints);
  const unclear = lowSpeechAudio || lowConfidence || (quality?.avgLogprob != null && quality.avgLogprob < HINT_ECHO_LOGPROB);
  if (hintTermCount >= 3 || (hintTermCount === 2 && unclear)) return { action: "retry", reason: "vocabulary-hint-echo" };

  if (HALLUCINATION_SUBSTRINGS.some((phrase) => normalized.includes(phrase.toLowerCase())) && (lowSpeechAudio || lowConfidence)) {
    return { action: "retry", reason: "known-hallucination-phrase" };
  }

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

// Fewest hint terms that spell out the whole transcript, or 0 when it holds any other word.
function hintEchoTermCount(tokens: readonly string[], hints: readonly string[]): number {
  const termTokens = hints
    .map(hint => (hint.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)?/gu) ?? []).map(token => token.toLowerCase()))
    .filter(term => term.length > 0);
  const words = tokens.map(token => token.toLowerCase());
  if (words.length === 0 || termTokens.length === 0) return 0;
  // fewest[i] is the fewest terms that cover words[i..], or Infinity when they cannot.
  const fewest: number[] = new Array(words.length + 1).fill(Number.POSITIVE_INFINITY);
  fewest[words.length] = 0;
  for (let index = words.length - 1; index >= 0; index -= 1) {
    for (const term of termTokens) {
      if (!term.every((token, offset) => words[index + offset] === token)) continue;
      fewest[index] = Math.min(fewest[index] ?? Number.POSITIVE_INFINITY, (fewest[index + term.length] ?? Number.POSITIVE_INFINITY) + 1);
    }
  }
  const count = fewest[0] ?? Number.POSITIVE_INFINITY;
  return Number.isFinite(count) ? count : 0;
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
