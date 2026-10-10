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

// Normalizes to NFC, lowercases, and keeps letters, combining marks, and digits. Marks stay because Devanagari vowel signs are marks.
export function normalizeWords(text: string): string[] {
  return text.normalize("NFC").toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((word) => word.length > 0);
}

// Word-level Levenshtein alignment. Returns the distance and which reference words the best alignment keeps exactly.
function align(reference: string[], hypothesis: string[]): { distance: number; matchedReference: boolean[] } {
  const cost: number[][] = [Array.from({ length: hypothesis.length + 1 }, (_, j) => j)];
  for (let i = 1; i <= reference.length; i++) {
    const previous = cost[i - 1] ?? [];
    const current = [i];
    for (let j = 1; j <= hypothesis.length; j++) {
      const mismatch = reference[i - 1] === hypothesis[j - 1] ? 0 : 1;
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + mismatch);
    }
    cost.push(current);
  }

  // Walks back from the end. Each reference word is either matched, substituted, or deleted.
  const matchedReference = new Array<boolean>(reference.length).fill(false);
  let i = reference.length;
  let j = hypothesis.length;
  while (i > 0 && j > 0) {
    const same = reference[i - 1] === hypothesis[j - 1];
    if ((cost[i]?.[j] ?? 0) === (cost[i - 1]?.[j - 1] ?? 0) + (same ? 0 : 1)) {
      matchedReference[i - 1] = same;
      i--;
      j--;
    } else if ((cost[i]?.[j] ?? 0) === (cost[i - 1]?.[j] ?? 0) + 1) {
      i--;
    } else {
      j--;
    }
  }
  return { distance: cost[reference.length]?.[hypothesis.length] ?? 0, matchedReference };
}

// Word error rate. An empty reference scores 0 only when the transcript is also empty.
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return align(ref, hyp).distance / ref.length;
}

// True when the reference's first word is deleted or substituted. Extra words before it do not count.
export function firstWordMissed(reference: string, hypothesis: string): boolean {
  const ref = normalizeWords(reference);
  return ref.length > 0 && align(ref, normalizeWords(hypothesis)).matchedReference[0] !== true;
}

// True when the reference's last word is deleted or substituted. Extra words after it do not count.
export function lastWordMissed(reference: string, hypothesis: string): boolean {
  const ref = normalizeWords(reference);
  return ref.length > 0 && align(ref, normalizeWords(hypothesis)).matchedReference[ref.length - 1] !== true;
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
