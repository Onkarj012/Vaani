import { NUMBER_WORDS } from "@shared/numberWords";
import { dropScratchedSentences, SENTENCE_RE } from "@shared/scratchThat";

const CORRECTION_PHRASES = String.raw`actually,?\s+make\s+that|no,?\s+i\s+mean|no,?\s+wait|i\s+mean|make\s+that|sorry`;
const MAX_AFTER_WORDS = 3;
// Words that open a new clause. A swapped number followed by one of these may start that clause ("3, sorry, 4 were out").
const CLAUSE_STARTERS = new Set(["was", "were", "is", "are", "am", "will", "would", "can", "could", "should", "have", "has", "had",
  "did", "do", "does", "i", "you", "he", "she", "we", "they", "it", "there", "that", "which", "who", "and", "but", "so", "or", "if"]);
const WORD_SHAPE_RE = /^[\p{L}\p{N}'’:-]+(?:\.\p{N}+)*$/u;
// Before-words, a cue, then the rest of the sentence. A bare "no" counts only between commas ("Friday, no, Thursday").
const CORRECTION_SENTENCE_RE = new RegExp(
  String.raw`^(?<lead>\s*)(?<before>[^\n]*?)(?:\s*,?\s*\b(?:${CORRECTION_PHRASES})\b\s*,?|\s*,\s*no\s*,)\s+(?<after>(?:[^.!?\n]|\.(?=\p{N}))+?)(?<end>[.!?]*)(?<trail>\s*)$`,
  "iu",
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

// Rewrites one sentence "<before> <cue> <after>" by swapping the last before-words for the first after-words,
// or returns it unchanged when unsafe. Words may follow the swap only when it is a number ("3.5, no, 4.5 minutes").
function fixSentence(sentence: string): string {
  const groups = CORRECTION_SENTENCE_RE.exec(sentence)?.groups;
  if (!groups) return sentence;
  const { lead = "", before = "", after = "", end = "", trail = "" } = groups;
  const words = before.split(/\s+/).filter(Boolean);
  const tokens = after.trim().split(/\s+/);
  const clean = tokens.map(token => token.replace(/,$/, ""));
  for (let count = 1; count <= Math.min(MAX_AFTER_WORDS, tokens.length); count += 1) {
    const replacement = clean.slice(0, count);
    if (!replacement.every(word => WORD_SHAPE_RE.test(word))) return sentence;
    // A comma inside the swap, or words after a swap that is not all numbers, makes the span unclear.
    if (tokens.slice(0, count - 1).some(token => token.endsWith(","))) return sentence;
    if (count < tokens.length && !replacement.every(word => wordKind(word) === "number")) continue;
    if (CLAUSE_STARTERS.has((clean[count] ?? "").toLowerCase())) return sentence;
    // At least one kept word must come first: a sentence-opening capital is no sign of a name ("Please make that Monday.").
    if (words.length <= count) continue;
    const head = words.slice(0, words.length - count);
    const replaced = words.slice(words.length - count);
    // A kept word of the same kind before the span means the span is part of a longer name or number.
    const lastKind = wordKind(head[head.length - 1] ?? "");
    const crowded = lastKind !== null && lastKind === wordKind(replacement[0] ?? "");
    if (!crowded && sameSlots(replaced, replacement)) return `${lead}${[...head, ...tokens].join(" ")}${end}${trail}`;
  }
  return sentence;
}

// Applies the self-corrections that need no model: safe same-kind swaps such as "3, no wait, 4" or "Friday, no, Thursday",
// and a "Scratch that." sentence, which drops the sentence before it.
export function applySelfCorrections(text: string): string {
  return dropScratchedSentences((text.match(SENTENCE_RE) ?? []).map(fixSentence).join(""));
}
