// Pure scoring for the transcription A/B script. No network, no Electron, no file access.

export interface ClipScore {
  /** Word error rate: word edits divided by reference word count. 0 is perfect. */
  wer: number;
  firstWordMissed: boolean;
  lastWordMissed: boolean;
  termCount: number;
  /** Reference terms whose words do not appear next to each other in the transcript. */
  missedTerms: string[];
}

// Lowercases and keeps letters, combining marks, and digits. Marks stay because Devanagari vowel signs are marks.
export function normalizeWords(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((word) => word.length > 0);
}

// Word-level Levenshtein distance. Substitutions, insertions, and deletions each cost 1.
function editDistance(reference: string[], hypothesis: string[]): number {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, j) => j);
  for (let i = 1; i <= reference.length; i++) {
    const current = [i];
    for (let j = 1; j <= hypothesis.length; j++) {
      const cost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1;
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
    }
    previous = current;
  }
  return previous[hypothesis.length] ?? 0;
}

// Word error rate. An empty reference scores 0 only when the transcript is also empty.
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return editDistance(ref, hyp) / ref.length;
}

// True when the transcript's first word is not the reference's first word.
export function firstWordMissed(reference: string, hypothesis: string): boolean {
  const ref = normalizeWords(reference);
  return ref.length > 0 && ref[0] !== normalizeWords(hypothesis)[0];
}

// True when the transcript's last word is not the reference's last word.
export function lastWordMissed(reference: string, hypothesis: string): boolean {
  const ref = normalizeWords(reference);
  return ref.length > 0 && ref.at(-1) !== normalizeWords(hypothesis).at(-1);
}

// Terms that do not appear in the transcript. Multi-word terms must appear as a run of words.
export function missingTerms(terms: string[], hypothesis: string): string[] {
  const hyp = normalizeWords(hypothesis);
  return terms.filter((term) => !containsRun(hyp, normalizeWords(term)));
}

// True when every word of the term appears in order and next to each other.
function containsRun(words: string[], term: string[]): boolean {
  if (term.length === 0) return true;
  return words.some((_, start) => term.every((word, offset) => words[start + offset] === word));
}

// Scores one clip against its reference text and its reference terms.
export function scoreClip(reference: string, hypothesis: string, terms: string[]): ClipScore {
  return {
    wer: wordErrorRate(reference, hypothesis),
    firstWordMissed: firstWordMissed(reference, hypothesis),
    lastWordMissed: lastWordMissed(reference, hypothesis),
    termCount: terms.length,
    missedTerms: missingTerms(terms, hypothesis),
  };
}
