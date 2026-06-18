import type { Settings } from "@shared/types";

interface TextCleanupInput {
  rawText: string;
  settings: Settings;
}

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeFillers(text: string, fillers: string[]): string {
  return fillers.reduce((t, f) => {
    const p = new RegExp(`(^|\\s)${escapeRegExp(f)}(?=\\s|$|[,.!?])`, "gi");
    return t.replace(p, " ");
  }, text);
}

function capitalizeSentences(text: string): string {
  return text.replace(/(^\s*[a-z])|([.!?]\s+[a-z])/g, m => m.toUpperCase());
}

function applySmartPunctuation(text: string): string {
  return text
    .replace(/"([^"]+)"/g, "\u201c$1\u201d")
    .replace(/'([^']+)'/g, "\u2018$1\u2019")
    .replace(/\s?--\s?/g, " \u2013 ")
    .replace(/\.{3,}/g, "\u2026");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
}

function normalizeCommonDictationArtifacts(text: string): string {
  let result = text.replace(/\bllmn\b/gi, "LLM");
  // Remove trailing "Vaani" — Whisper sometimes mishears trailing noise/silence as the app name
  result = result.replace(/[,.]?\s*\bvaani\b[.!?]?\s*$/i, "");
  return result;
}

const NUMBER_ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const NUMBER_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const NUMBER_WORDS = [...Object.keys(NUMBER_ONES), ...Object.keys(NUMBER_TENS), "hundred"]
  .sort((a, b) => b.length - a.length);
const NUMBER_RUN = new RegExp(
  `\\b(?:${NUMBER_WORDS.join("|")})(?:[\\s-]+(?:and[\\s-]+)?(?:${NUMBER_WORDS.join("|")}))*\\b`,
  "gi",
);

function parseNumberRun(phrase: string): number | null {
  const tokens = phrase.toLowerCase().split(/[\s-]+/).filter(t => t && t !== "and");
  let total = 0;
  let current = 0;
  for (const token of tokens) {
    const ones = NUMBER_ONES[token];
    const tens = NUMBER_TENS[token];
    if (ones !== undefined) {
      current += ones;
    } else if (tens !== undefined) {
      current += tens;
    } else if (token === "hundred") {
      current = (current || 1) * 100;
    } else {
      return null;
    }
  }
  return total + current;
}

// Conservative: convert common spoken cardinals to digits, plus percent/dollar
// phrases. Leaves ordinals, numbered-list cues, and the idiomatic standalone
// "one" untouched so prose is not damaged.
function normalizeCommonNumbers(text: string): string {
  const digitized = text.replace(NUMBER_RUN, (match) => {
    const normalized = match.toLowerCase().replace(/[\s-]+/g, " ").trim();
    if (normalized === "one") return match;
    const value = parseNumberRun(match);
    return value === null ? match : String(value);
  });
  return digitized
    .replace(/(\d+)\s+percent\b/gi, "$1%")
    .replace(/(\d+)\s+dollars?\b/gi, "$$$1");
}

function collapseAdjacentDuplicateWords(text: string): string {
  const preserveRepeats = new Set(["ha", "no", "ok", "okay", "really", "so", "very", "yes"]);
  return text.replace(
    /\b([\p{L}\p{N}][\p{L}\p{N}'-]{2,})([,.!?;:]?)(\s+)\1\b/giu,
    (match, word: string, punctuation: string, spacing: string) => {
      if (preserveRepeats.has(word.toLowerCase())) {
        return match;
      }
      return `${word}${punctuation}${spacing}`.trimEnd();
    }
  );
}

function normalizeLineWhitespace(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => normalizeWhitespace(line))
    .filter((line, index, lines) => line.length > 0 || (index > 0 && index < lines.length - 1))
    .join("\n")
    .trim();
}

function isListLine(text: string): boolean {
  return /^(([-*•])\s+|\d+[.)]\s+)/.test(text.trim());
}

function hasMultipleLines(text: string): boolean {
  return /\r?\n/.test(text);
}

function capitalizeLine(text: string): string {
  return text.replace(/^(\s*(?:[-*•]\s+|\d+[.)]\s+)?)([a-z])/, (_, prefix: string, first: string) => `${prefix}${first.toUpperCase()}`);
}

function ensureLinePunctuation(text: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed || /[.?!:]$/.test(trimmed) || isListLine(trimmed)) {
    return trimmed;
  }

  return `${trimmed}.`;
}

function applyCorrections(text: string, corrections: Array<{ spoken: string; written: string }>): string {
  return [...corrections]
    .sort((left, right) => right.spoken.trim().length - left.spoken.trim().length)
    .reduce((currentText, { spoken, written }) => {
      if (!spoken.trim()) return currentText;
      const pattern = new RegExp(`(^|\\s)${escapeRegExp(spoken.trim())}(?=\\s|$|[,.!?])`, "gi");
      return currentText.replace(pattern, (_, prefix) => `${prefix}${written}`);
    }, text);
}

function applySnippets(text: string, snippets: Array<{ trigger: string; content: string }>): string {
  return [...snippets]
    .sort((left, right) => right.trigger.trim().length - left.trigger.trim().length)
    .reduce((currentText, { trigger, content }) => {
      const t = trigger.trim();
      if (!t) return currentText;
      const pattern = new RegExp(`(^|\\s)/${escapeRegExp(t)}(?=\\s|$|[,.!?])`, "gi");
      return currentText.replace(pattern, (_, prefix) => `${prefix}${content}`);
    }, text);
}

export function cleanupText({ rawText, settings }: TextCleanupInput): string {
  const artifactNormalized = normalizeCommonDictationArtifacts(rawText);

  if (!settings.cleanupEnabled) {
    const deduped = collapseAdjacentDuplicateWords(artifactNormalized);
    return hasMultipleLines(deduped) ? normalizeLineWhitespace(deduped) : normalizeWhitespace(deduped);
  }

  const fillered = removeFillers(artifactNormalized, settings.fillerWords);
  const corrected = applyCorrections(fillered, settings.customCorrections ?? []);
  const snippeted = applySnippets(corrected, settings.snippets ?? []);
  const deduped = collapseAdjacentDuplicateWords(snippeted);
  const numbered = normalizeCommonNumbers(deduped);
  if (hasMultipleLines(numbered)) {
    const lines = numbered
      .split(/\r?\n/)
      .map(line => normalizeWhitespace(line))
      .filter((line, index, lines) => line.length > 0 || (index > 0 && index < lines.length - 1))
      .map(line => (line ? capitalizeLine(line) : line))
      .map(line => (settings.smartPunctuation ? applySmartPunctuation(line) : line))
      .map(line => (line ? ensureLinePunctuation(line) : line));

    return lines.join("\n");
  }

  const capitalized = capitalizeSentences(numbered);
  const punctuated = settings.smartPunctuation ? applySmartPunctuation(capitalized) : capitalized;
  const ensurePunctuation = /[.?!]$/.test(punctuated) ? punctuated : `${punctuated}.`;

  return normalizeWhitespace(ensurePunctuation);
}
