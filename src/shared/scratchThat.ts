const MARK_RE = /[.!?।]/u;
// A dotted abbreviation that ends at the mark, such as "p.m" in "p.m.".
const DOTTED_ABBREVIATION_RE = /(?:^|\s)(?:\p{L}\.)+\p{L}$/u;
// A list number at the start of a line, such as "2" in "2. Buy eggs.".
const LIST_MARKER_RE = /(?:^|\n)[ \t]*\p{N}+$/u;

// True when the marks at text[start..end) close a sentence. Marks inside a word ("3.5", "priya@example.com") do not,
// unless a lowercase letter meets a capital ("minutes.Next"). A dotted abbreviation before a lowercase word ("5 p.m.
// tomorrow") and a list number ("2. Buy") do not either. The Devanagari danda "।" ends a sentence too.
function endsSentence(text: string, start: number, end: number): boolean {
  const next = text[end];
  const before = text.slice(0, start);
  if (next !== undefined && !/\s/u.test(next)) return /\p{Ll}$/u.test(before) && /\p{Lu}/u.test(next);
  if (text.slice(start, end) !== ".") return true;
  if (LIST_MARKER_RE.test(before)) return false;
  return !(DOTTED_ABBREVIATION_RE.test(before) && /^[ \t]+\p{Ll}/u.test(text.slice(end)));
}

// Splits dictated text into sentences, each with the spaces after it. A run of line breaks is its own piece.
export function splitSentences(text: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    if (text[index] === "\n") {
      if (index > start) pieces.push(text.slice(start, index));
      start = index;
      while (index < text.length && /\s/u.test(text[index] ?? "")) index += 1;
      pieces.push(text.slice(start, index));
      start = index;
    } else if (MARK_RE.test(text[index] ?? "")) {
      const markStart = index;
      while (index < text.length && MARK_RE.test(text[index] ?? "")) index += 1;
      if (!endsSentence(text, markStart, index)) continue;
      while (text[index] === " " || text[index] === "\t") index += 1;
      pieces.push(text.slice(start, index));
      start = index;
    } else {
      index += 1;
    }
  }
  if (start < text.length) pieces.push(text.slice(start));
  return pieces;
}

// A sentence that only withdraws the sentence before it.
const SCRATCH_SENTENCE_RE = /^\s*(?:scratch|delete)\s+that[.!?।]*\s*$/i;
// A sentence with a letter or number, as opposed to a bare separator such as "\n" or "...".
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

// Removes the nearest kept sentence and the separators after it. Returns false when no sentence is kept.
function dropPreviousSentence(kept: string[]): boolean {
  let index = kept.length - 1;
  while (index >= 0 && !WORD_CHAR_RE.test(kept[index] ?? "")) index -= 1;
  if (index < 0) return false;
  kept.splice(index);
  return true;
}

// Drops each "Scratch that." or "Delete that." sentence with the sentence before it. A cue with nothing before it stays.
export function dropScratchedSentences(text: string): string {
  const kept: string[] = [];
  let dropped = false;
  let afterCue = false;
  for (const sentence of splitSentences(text)) {
    if (SCRATCH_SENTENCE_RE.test(sentence) && dropPreviousSentence(kept)) {
      dropped = true;
      afterCue = true;
      continue;
    }
    // The separator right after a withdrawn cue goes with it.
    if (afterCue && !WORD_CHAR_RE.test(sentence)) { afterCue = false; continue; }
    afterCue = false;
    kept.push(sentence);
  }
  if (!dropped) return text;
  // The removal may leave spaces at the cut. The text's own outer spacing is kept as it was.
  const lead = text.match(/^\s*/)?.[0] ?? "";
  const trail = text.match(/\s*$/)?.[0] ?? "";
  return `${lead}${kept.join("").trim()}${trail}`;
}
