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
  return text.replace(/\bllmn\b/gi, "LLM");
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
  if (hasMultipleLines(deduped)) {
    const lines = deduped
      .split(/\r?\n/)
      .map(line => normalizeWhitespace(line))
      .filter((line, index, lines) => line.length > 0 || (index > 0 && index < lines.length - 1))
      .map(line => (line ? capitalizeLine(line) : line))
      .map(line => (settings.smartPunctuation ? applySmartPunctuation(line) : line))
      .map(line => (line ? ensureLinePunctuation(line) : line));

    return lines.join("\n");
  }

  const capitalized = capitalizeSentences(deduped);
  const punctuated = settings.smartPunctuation ? applySmartPunctuation(capitalized) : capitalized;
  const ensurePunctuation = /[.?!]$/.test(punctuated) ? punctuated : `${punctuated}.`;

  return normalizeWhitespace(ensurePunctuation);
}
