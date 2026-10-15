import type { CustomCorrection, DictationCorrectionTrace, Settings, Snippet } from "@shared/types";
import { NUMBER_WORDS, parseNumberWords } from "@shared/numberWords";
import { editDistance, normalizedEditDistance } from "@shared/textDistance";
import { phoneticKeysEqual } from "@shared/phonetics";
import { HESITATION_WORDS, PROTECTED_WORDS } from "@shared/contentGuard";

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

// Non-speech tags that some transcription models write in square or round brackets. Other bracketed text is the speaker's.
const SOUND_TAG_WORDS = ["music", "applause", "laughter", "laughs", "noise", "silence", "inaudible", "blank_audio", "background noise", "cough", "coughs", "sigh", "breathing", "static", "crosstalk"];
const SOUND_TAG_ALTERNATION = SOUND_TAG_WORDS.join("|");
// A whole tag only, case-insensitive. "[draft]" and "items[0]" are not tags.
const SOUND_TAG_RE = new RegExp(String.raw`\[\s*(?:${SOUND_TAG_ALTERNATION})\s*\]|\(\s*(?:${SOUND_TAG_ALTERNATION})\s*\)`, "gi");

// Removes sound tags such as "[coughs]" or "[background noise]" that some transcription models add.
// They run before cleanup, so the formatter and the word guard only see spoken words.
export function stripSoundTags(text: string): string {
  return text
    .replace(SOUND_TAG_RE, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .trim();
}

// A hesitation sound as its own word.
const HESITATION_RE = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${HESITATION_WORDS.join("|")})(?![\p{L}\p{N}])[,.]?`, "giu");
// A number right before a position, so "10 mm" and "ten mm" keep their unit. Only "mm" is a unit.
const NUMBER_BEFORE_RE = new RegExp(String.raw`(?:\p{N}|(?<![\p{L}])(?:${NUMBER_WORDS.join("|")}))\s*$`, "iu");
// A Latin word followed by one or two hyphens and a space: "po- bad", "trans-- uh". "re-release" has no space.
const HYPHEN_END_RE = /(?<![\p{L}\p{M}\p{N}])(\p{Script=Latin}+)-{1,2}(?=\s)/gu;
// A Latin word said twice in a row: "the the". Digits ("1 1 2") and other scripts ("घर घर") are left alone.
const REPEATED_WORD_RE = /(?<![\p{L}\p{M}\p{N}'])(\p{Script=Latin}[\p{Script=Latin}']*)(?:,?\s+\1)+(?![\p{L}\p{M}\p{N}'])/giu;
// A two- or three-word Latin phrase said twice: "on the, on the".
const REPEATED_PHRASE_RE = /(?<![\p{L}\p{M}\p{N}'])(\p{Script=Latin}+(?:\s+\p{Script=Latin}+){1,2}),?\s+\1(?![\p{L}\p{M}\p{N}'])/giu;
// Doubles the grammar needs, and words a comma often separates on purpose ("look at it, it has").
const KEPT_DOUBLES: ReadonlySet<string> = new Set(["had", "that", "it", "this", "them", "very", "really", "so", "yes"]);
const SPELLED_NUMBERS: ReadonlySet<string> = new Set(NUMBER_WORDS);

// Collapses a repeat unless it is a number or a kept double said only twice.
function collapseRepeat(match: string, word: string): string {
  const lower = word.toLowerCase();
  if (SPELLED_NUMBERS.has(lower)) return match;
  return KEPT_DOUBLES.has(lower) && match.split(/,?\s+/).length === 2 ? match : word;
}

// Collapses a repeated phrase unless one of its words is a spelled-out number ("one two one two" is a value).
function collapsePhraseRepeat(match: string, phrase: string): string {
  return phrase.split(/\s+/).some(word => SPELLED_NUMBERS.has(word.toLowerCase())) ? match : phrase;
}

// Removes a word ending in a hyphen only when the speaker restarts after it: the next word starts with it ("ru- run"),
// a hesitation follows ("trans-- uh"), or the word before it comes again ("there sh- there"). Otherwise the hyphen is a
// dash or a suspended prefix ("Priya-- tomorrow", "pre- and post-paid"). A spelled-out number keeps its hyphen ("twenty- five").
function removeCutOffWords(line: string): string {
  return line.replace(HYPHEN_END_RE, (match: string, word: string, offset: number) => {
    const lower = word.toLowerCase();
    if (PROTECTED_WORDS.has(lower) || SPELLED_NUMBERS.has(lower)) return match;
    const next = (line.slice(offset + match.length).match(/^\s+([\p{L}\p{M}']+)/u)?.[1] ?? "").toLowerCase();
    const previous = (line.slice(0, offset).match(/([\p{L}\p{M}']+)[\s,]*$/u)?.[1] ?? "").toLowerCase();
    const restarts = (next.length > lower.length && next.startsWith(lower))
      || HESITATION_WORDS.includes(next)
      || (previous !== "" && previous === next && lower.length <= 3);
    return restarts && next !== "and" && next !== "or" ? " " : match;
  });
}

// Removes speech noise with fixed rules: cut-off words, hesitation sounds, and stutters.
// Used when the cleanup model did not run or its result was rejected, so the pasted text is still clean.
export function removeSpeechNoise(text: string): string {
  return text
    .split("\n")
    .map(line => removeCutOffWords(line)
      .replace(HESITATION_RE, (match: string, offset: number, whole: string) => (/^mm\b/i.test(match) && NUMBER_BEFORE_RE.test(whole.slice(0, offset)) ? match : " "))
      .replace(REPEATED_PHRASE_RE, collapsePhraseRepeat)
      .replace(REPEATED_WORD_RE, collapseRepeat)
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+([,.!?;:])/g, "$1")
      .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
      .replace(/(^|[.!?]\s+),\s*/g, "$1")
      .trim())
    .join("\n");
}

// Filler words the cleanup stage removes. Empty when cleanup is off.
export function activeFillerWords(settings: Settings): string[] {
  if (!settings.cleanupEnabled) return [];
  return [...(settings.fillerWords ?? []), ...(settings.extraFillerWords ?? [])];
}

// Words the cleanup model may drop: the filler words plus hesitation sounds. Empty when cleanup is off.
export function formatterDropWords(settings: Settings): string[] {
  if (!settings.cleanupEnabled) return [];
  return [...new Set([...activeFillerWords(settings), ...HESITATION_WORDS])];
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
    // A quote opens and closes only at a word edge, so the apostrophes in "I'll … I'll" never pair up.
    .replace(/(?<![\p{L}\p{N}])'(?=\S)([^']*?\S)'(?![\p{L}\p{N}])/gu, "\u2018$1\u2019")
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
    .replace(/(?<![\d.])(\.?\d+(?:[.,]\d+)*)\s+dollars?\b/gi, "$$$1");
}

function shouldNormalizeNumberRun(normalized: string): boolean {
  if (normalized === "one") return false;
  if (!normalized.startsWith("one ")) return true;
  if (/\bhundred\b/.test(normalized)) return true;
  return true;
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

// Literal occurrences of one rule, honoring its case and whole-word settings.
function exactReplacementCandidates(text: string, correction: CustomCorrection): TextReplacement[] {
  const spoken = correction.spoken.trim();
  const pattern = new RegExp(
    correction.wholeWord === false ? escapeRegExp(spoken) : `${OPEN_BOUNDARY}${escapeRegExp(spoken)}${CLOSE_BOUNDARY}`,
    correction.caseSensitive ? "g" : "gi",
  );
  return [...text.matchAll(pattern)].map(match => {
    const prefixLength = correction.wholeWord === false ? 0 : (match[1]?.length ?? 0);
    const start = (match.index ?? 0) + prefixLength;
    return { start, end: start + spoken.length, value: correction.written, correction: { spoken, written: correction.written } };
  });
}

// Fuzzy spans one word shorter, equal, or longer than the spoken phrase, so split or merged words still match.
function fuzzyReplacementCandidates(text: string, correction: CustomCorrection): TextReplacement[] {
  const spoken = correction.spoken.trim();
  if (correction.fuzzy !== true || spoken.length < 4) return [];
  const fold = (value: string): string => (correction.caseSensitive ? value : value.toLowerCase());
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
      // A case-only difference is an exact-match miss for case-sensitive rules, not a fuzzy hit.
      if (correction.caseSensitive && candidate.toLowerCase() === spoken.toLowerCase()) continue;
      if (normalizedEditDistance(candidate, spoken) >= MAX_EDIT_RATIO) continue;
      if (editDistance(fold(candidate), fold(spoken)) > 2) continue;
      if (!phoneticKeysEqual(candidate, spoken)) continue;
      candidates.push({ start, end, value: correction.written, correction: { spoken, written: correction.written } });
    }
  }
  return candidates;
}

// True when two replacement spans share any character.
function overlaps(left: TextReplacement, right: TextReplacement): boolean {
  return left.start < right.end && left.end > right.start;
}

// Keeps the longest candidates first and drops any that overlap a kept one.
function selectNonOverlapping(candidates: TextReplacement[]): TextReplacement[] {
  const selected: TextReplacement[] = [];
  const longestFirst = [...candidates].sort((left, right) => (right.end - right.start) - (left.end - left.start) || left.start - right.start);
  for (const candidate of longestFirst) {
    if (selected.some(existing => overlaps(candidate, existing))) continue;
    selected.push(candidate);
  }
  return selected;
}

// Exact matches are placed first. Fuzzy matches only fill spans no exact match touches.
export function applyDictionary(text: string, settings: Settings, trace?: TextCleanupTrace): string {
  const rules = (settings.customCorrections ?? []).filter(correction => correction.enabled !== false && correction.spoken.trim());
  const exact = selectNonOverlapping(rules.flatMap(correction => exactReplacementCandidates(text, correction)));
  const fuzzy = rules
    .flatMap(correction => fuzzyReplacementCandidates(text, correction))
    .filter(candidate => !exact.some(existing => overlaps(candidate, existing)));
  const selected = [...exact, ...selectNonOverlapping(fuzzy)];
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
      `|(^|[\\s,.!?;:])slash\\s+(${alternation})(?=\\s|$|[,.!?;:])` +
      (bareAlternation ? `|(^|[\\s,.!?;:])(${bareAlternation})(?=\\s|$|[,.!?;:])` : ""),
    "gi",
  );

  const byTrigger = new Map(ordered.map(snippet => [snippet.trigger.toLowerCase(), snippet.content]));
  const lookup = (raw: string): string => (byTrigger.get(raw.toLowerCase()) ?? raw).replace(/\{\{(date|time|clipboard)\}\}/g, (_match, name: "date" | "time" | "clipboard") => placeholderResolver?.(name) ?? `{{${name}}}`);

  return text.replace(
    combined,
    (_match, typedPrefix: string, typedName: string, snippetPrefix: string, snippetName: string, slashPrefix: string, slashName: string, barePrefix: string, bareName: string) =>
      typedName !== undefined
        ? `${typedPrefix}${lookup(typedName)}`
        : snippetName !== undefined
          ? `${snippetPrefix}${lookup(snippetName)}`
          : slashName !== undefined
            ? `${slashPrefix}${lookup(slashName)}`
          : `${barePrefix}${lookup(bareName)}`,
  );
}

export function cleanupText({ rawText, settings, trace, skipCorrections = false, appProfileId, placeholderResolver }: TextCleanupInput): string {
  // Dictionary corrections and snippet expansion are user-defined replacements —
  // apply them even when general cleanup is off, otherwise the dictionary never triggers.
  const corrected = skipCorrections ? rawText : applyDictionary(rawText, settings, trace);
  const expanded = applySnippets(corrected, settings.snippets ?? [], appProfileId, placeholderResolver);

  if (!settings.cleanupEnabled) {
    return hasMultipleLines(expanded) ? normalizeLineWhitespace(expanded) : normalizeWhitespace(expanded);
  }

  const fillered = removeFillers(expanded, activeFillerWords(settings));
  const numbered = normalizeCommonNumbers(fillered);
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
  const numbered = normalizeCommonNumbers(text);
  const capitalized = capitalizeSentences(numbered);
  const ensured = /[.?!]$/.test(capitalized.trim()) ? capitalized : `${capitalized}.`;
  return applySpokenLayout(normalizeWhitespace(ensured), {
    smartPunctuation: true,
  });
}

// True when the text has a letter or number, so it is worth inserting or copying.
export function hasSpokenContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}
