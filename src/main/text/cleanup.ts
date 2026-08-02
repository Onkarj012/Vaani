import type { CustomCorrection, DictationCorrectionTrace, Settings, Snippet } from "@shared/types";
import { NUMBER_WORDS, parseNumberWords } from "@shared/numberWords";
import { editDistance, normalizedEditDistance } from "@shared/textDistance";
import { phoneticKeysEqual } from "@shared/phonetics";

interface TextCleanupInput {
  rawText: string;
  settings: Settings;
  trace?: TextCleanupTrace;
  skipCorrections?: boolean;
  appProfileId?: string | null;
  placeholderResolver?: (name: "date" | "time" | "clipboard") => string;
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

const ORDINAL_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

interface LayoutReplacement {
  start: number;
  end: number;
  value: string;
}

interface CueMatch {
  kind: "point" | "number" | "item" | "marker";
  ordinal: number;
  start: number;
  end: number;
}

function applySpokenLayout(text: string, settings: Pick<Settings, "smartPunctuation">): string {
  let next = text
    .replace(/\s*\b(?:a\s+)?(?:new\s+paragraph|new\s+para)\b[,.!?;:]?\s*/gi, "\n\n")
    .replace(/\s*\b(?:new\s+line|next\s+line)\b[,.!?;:]?\s*/gi, "\n");

  next = applyEnumerationLayout(next);
  if (!hasMultipleLines(next)) return text;
  return formatExplicitLayoutText(next, settings);
}

function applyEnumerationLayout(text: string): string {
  const replacements = [
    ...findSequentialCueReplacements(text, findSpokenEnumerationCues(text)),
    ...findSequentialCueReplacements(text, findInlineNumberMarkers(text)),
  ].sort((left, right) => right.start - left.start);

  let next = text;
  for (const replacement of replacements) {
    next = `${next.slice(0, replacement.start)}${replacement.value}${next.slice(replacement.end)}`;
  }
  return next;
}

function findSpokenEnumerationCues(text: string): CueMatch[] {
  const matches: CueMatch[] = [];
  const pattern = /\b(point|number|item)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\b\s*[,.)-]?\s*/gi;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const rawOrdinal = match[2] ?? "";
    const ordinal = parseOrdinal(rawOrdinal);
    if (ordinal === null) continue;
    const after = text.slice(start + match[0].length).trimStart().toLowerCase();
    if (after.startsWith("%") || after.startsWith("percent") || after.startsWith("per cent") || after.startsWith("pencil")) {
      continue;
    }
    matches.push({
      kind: (match[1]?.toLowerCase() ?? "point") as CueMatch["kind"],
      ordinal,
      start,
      end: start + match[0].length,
    });
  }
  return matches;
}

function findInlineNumberMarkers(text: string): CueMatch[] {
  const matches: CueMatch[] = [];
  const pattern = /(?:^|[\s\n])(\d{1,2})([.)])?\s+(?=[A-Z])/g;
  for (const match of text.matchAll(pattern)) {
    const ordinal = Number(match[1]);
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 20) continue;
    const markerStart = (match.index ?? 0) + match[0].indexOf(match[1] ?? "");
    matches.push({
      kind: "marker",
      ordinal,
      start: markerStart,
      end: markerStart + (match[1]?.length ?? 0) + (match[2]?.length ?? 0) + 1,
    });
  }
  return matches;
}

function findSequentialCueReplacements(text: string, matches: CueMatch[]): LayoutReplacement[] {
  const replacements: LayoutReplacement[] = [];
  let index = 0;
  while (index < matches.length) {
    const group = [matches[index]!];
    let cursor = index + 1;
    while (
      cursor < matches.length &&
      matches[cursor]!.kind === group[0]!.kind &&
      matches[cursor]!.ordinal === group[group.length - 1]!.ordinal + 1
    ) {
      group.push(matches[cursor]!);
      cursor += 1;
    }

    if (group.length >= 2) {
      for (const [groupIndex, match] of group.entries()) {
        replacements.push({
          start: match.start,
          end: match.end,
          value: listMarkerReplacement(text, match.start, match.ordinal, groupIndex === 0),
        });
      }
      index = cursor;
    } else {
      index += 1;
    }
  }
  return replacements;
}

function listMarkerReplacement(text: string, start: number, ordinal: number, firstInGroup: boolean): string {
  const before = text.slice(0, start);
  if (!firstInGroup) return /\n\s*$/.test(before) ? `${ordinal}. ` : `\n${ordinal}. `;
  if (before.trim().length === 0 || /\n\s*$/.test(before)) return `${ordinal}. `;
  return `\n\n${ordinal}. `;
}

function parseOrdinal(raw: string): number | null {
  const normalized = raw.toLowerCase();
  const word = ORDINAL_WORDS[normalized];
  if (word !== undefined) return word;
  const digit = Number(normalized);
  return Number.isInteger(digit) && digit > 0 ? digit : null;
}

function formatExplicitLayoutText(text: string, settings: Pick<Settings, "smartPunctuation">): string {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .split(/\n{2,}/)
    .map(paragraph => paragraph
      .split(/\n+/)
      .map(line => normalizeWhitespace(line))
      .filter(Boolean)
      .map(line => capitalizeLine(line))
      .map(line => (settings.smartPunctuation ? applySmartPunctuation(line) : line))
      .map(line => ensureLinePunctuation(line))
      .join("\n"))
    .filter(Boolean)
    .join("\n\n")
    .trim();
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
    .replace(/\bone\s+percent\b/gi, "1%")
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
  let next = text;
  while (true) {
    const collapsed = next.replace(
      /\b([\p{L}\p{N}][\p{L}\p{N}'-]*)([,.!?;:]?)(\s+)\1\b/giu,
      (match, word: string, punctuation: string, spacing: string) => preserveRepeats.has(word.toLowerCase())
        ? match
        : `${word}${punctuation}${spacing}`.trimEnd(),
    );
    if (collapsed === next) return next;
    next = collapsed;
  }
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

interface TextReplacement {
  start: number;
  end: number;
  value: string;
  correction?: DictationCorrectionTrace;
}

const MAX_EDIT_RATIO = 0.5;
const TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;
const OPEN_BOUNDARY = "(^|[\\s([\\{\\\"'“‘])";
const CLOSE_BOUNDARY = "(?=\\s|$|[,.!?;:)\\]}\\\"'“”‘’…-])";

function fuzzyReplacementCandidates(text: string, correction: CustomCorrection): TextReplacement[] {
  const spoken = correction.spoken.trim();
  if (correction.fuzzy !== true || spoken.length < 4) return [];
  const tokens = [...text.matchAll(TOKEN_PATTERN)];
  const wordCount = spoken.split(/\s+/).length;
  const candidates: TextReplacement[] = [];
  for (let index = 0; index < tokens.length; index++) {
    for (const count of [wordCount - 1, wordCount, wordCount + 1]) {
      if (count < 1 || index + count > tokens.length) continue;
      const first = tokens[index];
      const last = tokens[index + count - 1];
      if (first?.index === undefined || last?.index === undefined) continue;
      const start = first.index;
      const end = last.index + last[0].length;
      const candidate = text.slice(start, end);
      if (normalizedEditDistance(candidate, spoken) >= MAX_EDIT_RATIO) continue;
      if (editDistance(candidate.toLowerCase(), spoken.toLowerCase()) > 2) continue;
      if (!phoneticKeysEqual(candidate, spoken)) continue;
      candidates.push({ start, end, value: correction.written, correction: { spoken, written: correction.written } });
    }
  }
  return candidates;
}

export function applyDictionary(text: string, settings: Settings, trace?: TextCleanupTrace): string {
  const replacements: TextReplacement[] = [];
  for (const correction of settings.customCorrections ?? []) {
    if (correction.enabled === false) continue;
    const spoken = correction.spoken.trim();
    if (!spoken) continue;
    const pattern = new RegExp(
      correction.wholeWord === false ? escapeRegExp(spoken) : `${OPEN_BOUNDARY}${escapeRegExp(spoken)}${CLOSE_BOUNDARY}`,
      correction.caseSensitive ? "g" : "gi",
    );
    for (const match of text.matchAll(pattern)) {
      const prefixLength = correction.wholeWord === false ? 0 : (match[1]?.length ?? 0);
      const start = (match.index ?? 0) + prefixLength;
      replacements.push({ start, end: start + spoken.length, value: correction.written, correction: { spoken, written: correction.written } });
    }
    replacements.push(...fuzzyReplacementCandidates(text, correction));
  }
  const selected: TextReplacement[] = [];
  for (const candidate of replacements.sort((left, right) => (right.end - right.start) - (left.end - left.start) || left.start - right.start)) {
    if (selected.some(existing => candidate.start < existing.end && candidate.end > existing.start)) continue;
    selected.push(candidate);
  }
  const matched = new Set<string>();
  for (const replacement of selected) if (replacement.correction) matched.add(JSON.stringify(replacement.correction));
  for (const encoded of matched) trace?.correctionsApplied.push(JSON.parse(encoded) as DictationCorrectionTrace);
  return [...selected].sort((left, right) => right.start - left.start).reduce(
    (current, replacement) => `${current.slice(0, replacement.start)}${replacement.value}${current.slice(replacement.end)}`,
    text,
  );
}

function applySnippets(
  text: string,
  snippets: Snippet[],
  appProfileId: string | null | undefined,
  placeholderResolver?: (name: "date" | "time" | "clipboard") => string,
): string {
  // Longest-trigger-first so overlapping triggers resolve to the longest match.
  const ordered = [...snippets]
    .map(snippet => ({ ...snippet, trigger: snippet.trigger.trim() }))
    .filter(({ trigger, appProfileIds }) => trigger.length > 0 && (!appProfileIds || (appProfileId !== null && appProfileId !== undefined && appProfileIds.includes(appProfileId))))
    .sort((left, right) => right.trigger.length - left.trigger.length);

  if (ordered.length === 0) return text;

  // Match BOTH the typed (`/name`) and spoken (`snippet name`) forms in a single
  // combined regex and replace in ONE pass over the original text. A single pass
  // means content inserted by any match is never re-scanned, eliminating
  // cross-form cascade (e.g. a typed snippet whose body contains `snippet name`
  // expanding again on a separate spoken pass).
  const alternation = ordered.map(({ trigger }) => escapeRegExp(trigger)).join("|");
  const bareAlternation = ordered
    .filter(({ trigger, matchBareTrigger }) => (matchBareTrigger ?? false) && (trigger.length >= 6 || trigger.split(/\s+/).length >= 2))
    .map(({ trigger }) => escapeRegExp(trigger))
    .join("|");
  const combined = new RegExp(
    `(^|\\s)/(${alternation})(?=\\s|$|[,.!?;:])` +
      `|(^|[\\s,.!?;:])snippet\\s+(${alternation})(?=\\s|$|[,.!?;:])` +
      (bareAlternation ? `|(^|[\\s,.!?;:])(${bareAlternation})(?=\\s|$|[,.!?;:])` : ""),
    "gi",
  );

  const byTrigger = new Map(ordered.map(snippet => [snippet.trigger.toLowerCase(), snippet.content]));
  const lookup = (raw: string): string => (byTrigger.get(raw.toLowerCase()) ?? raw).replace(/\{\{(date|time|clipboard)\}\}/g, (_match, name: "date" | "time" | "clipboard") => placeholderResolver?.(name) ?? `{{${name}}}`);

  return text.replace(
    combined,
    (_match, typedPrefix: string, typedName: string, spokenPrefix: string, spokenName: string, barePrefix: string, bareName: string) =>
      typedName !== undefined
        ? `${typedPrefix}${lookup(typedName)}`
        : spokenName !== undefined
          ? `${spokenPrefix}${lookup(spokenName)}`
          : `${barePrefix}${lookup(bareName)}`,
  );
}

export function cleanupText({ rawText, settings, trace, skipCorrections = false, appProfileId, placeholderResolver }: TextCleanupInput): string {
  // Dictionary corrections and snippet expansion are user-defined replacements —
  // apply them even when general cleanup is off, otherwise the dictionary never triggers.
  const corrected = skipCorrections ? rawText : applyDictionary(rawText, settings, trace);
  const expanded = applySnippets(corrected, settings.snippets ?? [], appProfileId, placeholderResolver);

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
    return applySpokenLayout(formatMultilineText(numbered, settings), settings);
  }

  const capitalized = capitalizeSentences(numbered);
  const punctuated = settings.smartPunctuation ? applySmartPunctuation(capitalized) : capitalized;
  const ensurePunctuation = /[.?!]$/.test(punctuated) ? punctuated : `${punctuated}.`;

  return applySpokenLayout(normalizeWhitespace(ensurePunctuation), settings);
}

// Deterministic formatting without requiring full Settings — used as LLM fallback.
export function deterministicFormat(text: string): string {
  const deduped = collapseAdjacentDuplicateWords(text);
  const numbered = normalizeCommonNumbers(deduped);
  const capitalized = capitalizeSentences(numbered);
  const ensured = /[.?!]$/.test(capitalized.trim()) ? capitalized : `${capitalized}.`;
  return applySpokenLayout(normalizeWhitespace(ensured), {
    smartPunctuation: true,
  });
}
