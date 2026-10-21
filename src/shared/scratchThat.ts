const MARK_RE = /[.!?।]/u;
// Quotes and brackets that close a sentence right after its mark: 'He said "Stop."'.
const CLOSER_RE = /["'”’»)\]]/u;
// A dotted abbreviation that ends at the mark, such as "p.m" in "p.m.".
const DOTTED_ABBREVIATION_RE = /(?:^|\s)(?:\p{L}\.)+\p{L}$/u;
// A title that a name always follows, such as "Dr" in "Dr. Smith".
const TITLE_RE = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof)$/u;
// A list number at the start of a line, such as "2" in "2. Buy eggs.".
const LIST_MARKER_RE = /(?:^|\n)[ \t]*\p{N}+$/u;
// A "Scratch that" cue right after a number, such as "500. Scratch that.", starts a sentence of its own.
const CUE_AFTER_RE = /^[\p{Zs}\t]+(?:scratch|delete)\s+that(?:[.!?।]+(?=\s|$)|\s*$)/iu;

// True when the marks at text[start..markEnd), with any closers up to end, close a sentence. When unsure it says yes:
// a wrong split only keeps text, while a wrong merge lets "Scratch that." withdraw two sentences. Only a single dot
// between a letter or digit and a lowercase letter or digit sits inside a word ("3.5", "priya@example.com", "p.m");
// "500.Pay" and "4!2" end a sentence, and so does a Devanagari danda "।". A title ("Dr. Smith"), a dotted
// abbreviation before a lowercase word ("5 p.m. tomorrow") and a list number ("2. Buy") do not, unless a cue follows it.
function endsSentence(text: string, start: number, markEnd: number, end: number): boolean {
  const next = text[end];
  const before = text.slice(0, start);
  const marks = text.slice(start, markEnd);
  if (marks.includes("।")) return true;
  if (next !== undefined && !/\s/u.test(next)) return !(marks === "." && end === markEnd && /[\p{L}\p{N}]$/u.test(before) && /[\p{Ll}\p{N}]/u.test(next));
  if (marks !== ".") return true;
  if (LIST_MARKER_RE.test(before) && !CUE_AFTER_RE.test(text.slice(end))) return false;
  // A title counts only as written, right before a name: "500 ms. Pay" and 'Dr." Next' still split.
  if (TITLE_RE.test(before) && end === markEnd && /^[ \t]+\p{Lu}/u.test(text.slice(end))) return false;
  return !(end === markEnd && DOTTED_ABBREVIATION_RE.test(before) && /^[ \t]+\p{Ll}/u.test(text.slice(end)));
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
      const markEnd = index;
      while (index < text.length && CLOSER_RE.test(text[index] ?? "")) index += 1;
      if (!endsSentence(text, markStart, markEnd, index)) continue;
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
// A sentence that is only hesitation, such as "Um." or "Uh, um...".
const HESITATION_ONLY_RE = /^\s*(?:(?:um+|uh+|erm|hmm+)[,.!?।\s]*)+$/i;
// A hesitation before the cue ("Um, scratch that.") still counts as the cue.
const SCRATCH_SENTENCE_RE = /^\s*(?:(?:um+|uh+|erm|hmm+)[,\s]+)*(?:scratch|delete)\s+that[.!?।]*\s*$/i;
// A sentence with a letter or number, as opposed to a bare separator such as "\n" or "...".
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

// Removes the nearest kept sentence and the separators after it. Returns false when no sentence is kept.
function dropPreviousSentence(kept: string[]): boolean {
  let index = kept.length - 1;
  // Separators and hesitation-only sentences ("Um.") are skipped, so the cue reaches the sentence it withdraws.
  while (index >= 0 && (!WORD_CHAR_RE.test(kept[index] ?? "") || HESITATION_ONLY_RE.test(kept[index] ?? ""))) index -= 1;
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
