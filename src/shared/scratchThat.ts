// Sentences of dictated text. A mark with a non-space right after it ("3.5", "priya@example.com", "p.m") is
// inside a word, not a sentence end. The Devanagari danda "।" ends a sentence too.
export const SENTENCE_RE = /(?:[^.!?।\n]|[.!?।](?=[^\s.!?।]))+[.!?।]*[ \t]*|[.!?।\n]+[ \t]*/gu;
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
  for (const sentence of text.match(SENTENCE_RE) ?? []) {
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
