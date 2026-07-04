import type { DictationCorrectionTrace, Settings } from "@shared/types";
import { NUMBER_WORDS, parseNumberWords } from "@shared/numberWords";

interface TextCleanupInput {
  rawText: string;
  settings: Settings;
  trace?: TextCleanupTrace;
}

export interface TextCleanupTrace {
  correctionsApplied: DictationCorrectionTrace[];
}

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeFillers(text: string, fillers: string[]): string {
  return fillers.reduce((t, f) => {
    const pattern = f === "um" || f === "uh" ? `${escapeRegExp(f)}+` : escapeRegExp(f);
    const p = new RegExp(`(^|\\s)${pattern}(?=\\s|$|[,.!?])`, "gi");
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
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    // Drop a dangling comma/semicolon sitting directly before terminal punctuation
    // (e.g. "press,." -> "press.") — common when an LLM lists items with trailing commas.
    .replace(/[,;]+(?=[.!?])/g, "")
    .trim();
}

function normalizeCommonDictationArtifacts(text: string): string {
  return text.replace(/\bllmn\b/gi, "LLM");
}

const NUMBER_RUN = new RegExp(
  `\\b(?:${NUMBER_WORDS.join("|")})(?:[\\s-]+(?:and[\\s-]+)?(?:${NUMBER_WORDS.join("|")}))*\\b`,
  "gi",
);

// Conservative: convert common spoken cardinals to digits, plus percent/dollar
// phrases. Leaves ordinals, numbered-list cues, and the idiomatic standalone
// "one" untouched so prose is not damaged.
function normalizeCommonNumbers(text: string): string {
  const digitized = text.replace(NUMBER_RUN, (match) => {
    const normalized = match.toLowerCase().replace(/[\s-]+/g, " ").trim();
    if (!shouldNormalizeNumberRun(normalized)) return match;
    const value = parseNumberWords(match);
    return value === null ? match : String(value);
  });
  return digitized
    .replace(/(\d+)\s+percent\b/gi, "$1%")
    .replace(/(\d+)\s+dollars?\b/gi, "$$$1");
}

function shouldNormalizeNumberRun(normalized: string): boolean {
  if (normalized === "one") return false;
  if (!normalized.startsWith("one ")) return true;
  if (/\bhundred\b/.test(normalized)) return true;
  return true;
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

function hasParagraphBreak(text: string): boolean {
  return /\r?\n[ \t]*\r?\n/.test(text);
}

function capitalizeLine(text: string): string {
  return text.replace(/^(\s*(?:[-*•]\s+|\d+[.)]\s+)?)([a-z])/, (_, prefix: string, first: string) => `${prefix}${first.toUpperCase()}`);
}

function ensureLinePunctuation(text: string): string {
  // Strip a dangling list comma/semicolon so it becomes a period, not "press,.".
  const trimmed = text.trimEnd().replace(/[,;]+$/, "");
  if (!trimmed || /[.?!:]$/.test(trimmed) || isListLine(trimmed)) {
    return trimmed;
  }

  return `${trimmed}.`;
}

function formatPlainParagraph(text: string, settings: Settings): string {
  const normalized = normalizeWhitespace(text);
  const capitalized = capitalizeSentences(normalized);
  const punctuated = settings.smartPunctuation ? applySmartPunctuation(capitalized) : capitalized;
  return ensureLinePunctuation(punctuated);
}

function formatLineBlock(text: string, settings: Settings): string {
  const lines = text
    .split(/\r?\n/)
    .map(line => normalizeWhitespace(line))
    .filter((line, index, lines) => line.length > 0 || (index > 0 && index < lines.length - 1))
    .map(line => (line ? capitalizeLine(line) : line))
    .map(line => (settings.smartPunctuation ? applySmartPunctuation(line) : line))
    .map(line => (line ? ensureLinePunctuation(line) : line));

  return lines.join("\n");
}

function isListBlock(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map(line => normalizeWhitespace(line))
    .filter(Boolean);
  return lines.length > 0 && lines.every(isListLine);
}

function formatParagraphBlock(text: string, settings: Settings): string {
  const normalized = normalizeLineWhitespace(text);
  if (!normalized) return "";
  if (isListBlock(normalized)) return formatLineBlock(normalized, settings);

  const reflowed = normalized
    .split(/\r?\n/)
    .map(line => normalizeWhitespace(line))
    .filter(Boolean)
    .join(" ");
  return formatPlainParagraph(reflowed, settings);
}

function normalizeParagraphSeparator(separator: string): string {
  const newlineCount = separator.match(/\r?\n/g)?.length ?? 2;
  return "\n".repeat(Math.max(2, newlineCount));
}

function formatMultilineText(text: string, settings: Settings): string {
  if (!hasParagraphBreak(text)) return formatLineBlock(text, settings);

  return text
    .split(/(\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*)/g)
    .filter(part => part.length > 0)
    .map(part => hasParagraphBreak(part)
      ? normalizeParagraphSeparator(part)
      : formatParagraphBlock(part, settings))
    .join("")
    .trim();
}

function applyCorrections(text: string, corrections: Array<{ spoken: string; written: string }>, trace?: TextCleanupTrace): string {
  return [...corrections]
    .sort((left, right) => right.spoken.trim().length - left.spoken.trim().length)
    .reduce((currentText, { spoken, written }) => {
      const trimmedSpoken = spoken.trim();
      if (!trimmedSpoken) return currentText;
      const pattern = new RegExp(`(^|\\s)${escapeRegExp(trimmedSpoken)}(?=\\s|$|[,.!?])`, "gi");
      let matched = false;
      const nextText = currentText.replace(pattern, (_, prefix) => {
        matched = true;
        return `${prefix}${written}`;
      });
      if (matched) trace?.correctionsApplied.push({ spoken: trimmedSpoken, written });
      return nextText;
    }, text);
}

function applySnippets(text: string, snippets: Array<{ trigger: string; content: string }>): string {
  // Longest-trigger-first so overlapping triggers resolve to the longest match.
  const ordered = [...snippets]
    .map(({ trigger, content }) => ({ trigger: trigger.trim(), content }))
    .filter(({ trigger }) => trigger.length > 0)
    .sort((left, right) => right.trigger.length - left.trigger.length);

  if (ordered.length === 0) return text;

  // Match BOTH the typed (`/name`) and spoken (`snippet name`) forms in a single
  // combined regex and replace in ONE pass over the original text. A single pass
  // means content inserted by any match is never re-scanned, eliminating
  // cross-form cascade (e.g. a typed snippet whose body contains `snippet name`
  // expanding again on a separate spoken pass).
  const alternation = ordered.map(({ trigger }) => escapeRegExp(trigger)).join("|");
  const combined = new RegExp(
    `(^|\\s)/(${alternation})(?=\\s|$|[,.!?;:])` +
      `|(^|[\\s,.!?;:])snippet\\s+(${alternation})(?=\\s|$|[,.!?;:])`,
    "gi",
  );

  const byTrigger = new Map(ordered.map(({ trigger, content }) => [trigger.toLowerCase(), content]));
  const lookup = (raw: string): string => byTrigger.get(raw.toLowerCase()) ?? raw;

  return text.replace(
    combined,
    (_match, typedPrefix: string, typedName: string, spokenPrefix: string, spokenName: string) =>
      typedName !== undefined
        ? `${typedPrefix}${lookup(typedName)}`
        : `${spokenPrefix}${lookup(spokenName)}`,
  );
}

export function cleanupText({ rawText, settings, trace }: TextCleanupInput): string {
  const artifactNormalized = normalizeCommonDictationArtifacts(rawText);

  // Dictionary corrections and snippet expansion are user-defined replacements —
  // apply them even when general cleanup is off, otherwise the dictionary never triggers.
  const corrected = applyCorrections(artifactNormalized, settings.customCorrections ?? [], trace);
  const expanded = applySnippets(corrected, settings.snippets ?? []);

  if (!settings.cleanupEnabled) {
    const deduped = collapseAdjacentDuplicateWords(expanded);
    return hasMultipleLines(deduped) ? normalizeLineWhitespace(deduped) : normalizeWhitespace(deduped);
  }

  const fillered = removeFillers(expanded, [
    ...(settings.fillerWords ?? []),
    ...(settings.extraFillerWords ?? []),
  ]);
  const deduped = collapseAdjacentDuplicateWords(fillered);
  const numbered = normalizeCommonNumbers(deduped);
  if (hasMultipleLines(numbered)) {
    return formatMultilineText(numbered, settings);
  }

  const capitalized = capitalizeSentences(numbered);
  const punctuated = settings.smartPunctuation ? applySmartPunctuation(capitalized) : capitalized;
  const ensurePunctuation = /[.?!]$/.test(punctuated) ? punctuated : `${punctuated}.`;

  return normalizeWhitespace(ensurePunctuation);
}

// Deterministic formatting without requiring full Settings — used as LLM fallback.
export function deterministicFormat(text: string): string {
  const deduped = collapseAdjacentDuplicateWords(text);
  const numbered = normalizeCommonNumbers(deduped);
  const capitalized = capitalizeSentences(numbered);
  const ensured = /[.?!]$/.test(capitalized.trim()) ? capitalized : `${capitalized}.`;
  return normalizeWhitespace(ensured);
}
