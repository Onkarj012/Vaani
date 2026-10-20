// Sentences of dictated text. A dot between digits ("3.5", "1.2.0") is part of the number, not a sentence end.
export const SENTENCE_RE = /(?:[^.!?\n]|\.(?=\p{N}))+[.!?]*[ \t]*|[.!?\n]+[ \t]*/gu;
// A sentence that only withdraws the sentence before it.
const SCRATCH_SENTENCE_RE = /^\s*(?:scratch|delete)\s+that[.!?]*\s*$/i;
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
  for (const sentence of text.match(SENTENCE_RE) ?? []) {
    if (SCRATCH_SENTENCE_RE.test(sentence) && dropPreviousSentence(kept)) {
      dropped = true;
      continue;
    }
    kept.push(sentence);
  }
  if (!dropped) return text;
  // The removal may leave spaces at the cut. The text's own outer spacing is kept as it was.
  const lead = text.match(/^\s*/)?.[0] ?? "";
  const trail = text.match(/\s*$/)?.[0] ?? "";
  return `${lead}${kept.join("").trim()}${trail}`;
}
