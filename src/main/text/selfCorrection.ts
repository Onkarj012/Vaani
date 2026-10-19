import { NUMBER_WORDS } from "@shared/numberWords";

const CORRECTION_PHRASES = String.raw`actually,?\s+make\s+that|no,?\s+i\s+mean|no,?\s+wait|i\s+mean|make\s+that|sorry`;
const MAX_AFTER_WORDS = 3;
// A dot between digits ("3.5", "1.2.0") is part of the number, not a sentence end.
const SENTENCE_RE = /(?:[^.!?\n]|\.(?=\p{N}))+[.!?]*[ \t]*|[.!?\n]+[ \t]*/gu;
const WORD_SHAPE_RE = /^[\p{L}\p{N}'’:-]+$/u;
// Before-words, a cue, then 1-3 words that end the sentence. A bare "no" counts only between commas ("Friday, no, Thursday").
const CORRECTION_SENTENCE_RE = new RegExp(
  String.raw`^(?<lead>\s*)(?<before>[^\n]*?)(?:\s*,?\s*\b(?:${CORRECTION_PHRASES})\b\s*,?|\s*,\s*no\s*,)\s+(?<after>[^,.!?\n]+?)(?<end>[.!?]*)(?<trail>\s*)$`,
  "i",
);

// The kind of a word that may replace another: "number" or "name", or null for anything else.
function wordKind(word: string): "number" | "name" | null {
  if (/^\d/.test(word) || NUMBER_WORDS.includes(word.toLowerCase())) return "number";
  return /^\p{Lu}\p{Ll}+$/u.test(word) ? "name" : null;
}

// True when each before-word is the same word as its after-word, or the same kind.
function sameSlots(before: string[], after: string[]): boolean {
  return before.every((word, index) => {
    const next = after[index] ?? "";
    const kind = wordKind(word);
    return word.toLowerCase() === next.toLowerCase() || (kind !== null && kind === wordKind(next));
  });
}

// Rewrites one sentence "<before> <cue> <after>" by replacing the last before-words, or returns it unchanged when unsafe.
function fixSentence(sentence: string): string {
  const groups = CORRECTION_SENTENCE_RE.exec(sentence)?.groups;
  if (!groups) return sentence;
  const { lead = "", before = "", after = "", end = "", trail = "" } = groups;
  const words = before.split(/\s+/).filter(Boolean);
  const replacement = after.trim().split(/\s+/);
  const count = replacement.length;
  if (count > MAX_AFTER_WORDS || !replacement.every(word => WORD_SHAPE_RE.test(word))) return sentence;
  // At least one kept word must come first: a sentence-opening capital is no sign of a name ("Please make that Monday.").
  if (words.length <= count) return sentence;

  const head = words.slice(0, words.length - count);
  const replaced = words.slice(words.length - count);
  // A kept word of the same kind before the span means the span is part of a longer name or number.
  const lastKind = wordKind(head[head.length - 1] ?? "");
  const crowded = lastKind !== null && lastKind === wordKind(replacement[0] ?? "");
  if (crowded || !sameSlots(replaced, replacement)) return sentence;
  return `${lead}${[...head, ...replacement].join(" ")}${end}${trail}`;
}

// Applies the self-corrections that need no model: safe same-kind swaps such as "3, no wait, 4" or "Friday, no, Thursday".
export function applySelfCorrections(text: string): string {
  return (text.match(SENTENCE_RE) ?? []).map(fixSentence).join("");
}
