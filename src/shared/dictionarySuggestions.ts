export interface DictionarySuggestion {
  spoken: string;
  written: string;
}

// Maximum normalized edit distance (Levenshtein / max-len) to accept a mishear.
// Keeps genuine homophones/typos (git hub→GitHub ≈ 0.14) while rejecting
// unrelated rewrites and pure deletions (world there→there ≈ 0.55).
const MAX_EDIT_RATIO = 0.5;

export function detectDictionarySuggestions(originalText: string, correctedText: string): DictionarySuggestion[] {
  const originalTokens = tokenize(originalText);
  const correctedTokens = tokenize(correctedText);
  if (originalTokens.length === 0 || correctedTokens.length === 0) return [];

  const suggestions: DictionarySuggestion[] = [];
  let originalIndex = 0;
  let correctedIndex = 0;

  while (originalIndex < originalTokens.length && correctedIndex < correctedTokens.length) {
    const spoken = originalTokens[originalIndex];
    const written = correctedTokens[correctedIndex];
    if (!spoken || !written || spoken.toLowerCase() === written.toLowerCase()) {
      originalIndex += 1;
      correctedIndex += 1;
      continue;
    }

    if (
      originalIndex + 1 < originalTokens.length
      && suffixesMatch(originalTokens, originalIndex + 2, correctedTokens, correctedIndex + 1)
    ) {
      suggestions.push({
        spoken: `${spoken} ${originalTokens[originalIndex + 1]}`,
        written
      });
      originalIndex += 2;
      correctedIndex += 1;
      continue;
    }

    if (
      correctedIndex + 1 < correctedTokens.length
      && suffixesMatch(originalTokens, originalIndex + 1, correctedTokens, correctedIndex + 2)
    ) {
      suggestions.push({
        spoken,
        written: `${written} ${correctedTokens[correctedIndex + 1]}`
      });
      originalIndex += 1;
      correctedIndex += 2;
      continue;
    }

    suggestions.push({ spoken, written });
    originalIndex += 1;
    correctedIndex += 1;
  }

  if (originalIndex !== originalTokens.length || correctedIndex !== correctedTokens.length) {
    return [];
  }

  const deduped = dedupeSuggestions(suggestions);

  // Gate: exactly one substitution, both sides non-empty, phonetically close.
  if (deduped.length !== 1) return [];
  const only = deduped[0];
  if (!only || !only.spoken || !only.written) return [];
  if (normalizedEditDistance(only.spoken, only.written) >= MAX_EDIT_RATIO) return [];
  if (addsDigit(only.spoken, only.written)) return [];

  return deduped;
}

function addsDigit(spoken: string, written: string): boolean {
  const spokenDigits = new Set(spoken.match(/\d/g) ?? []);
  return (written.match(/\d/g) ?? []).some((digit) => !spokenDigits.has(digit));
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter(Boolean);
}

function dedupeSuggestions(suggestions: DictionarySuggestion[]): DictionarySuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = `${suggestion.spoken.toLowerCase()}=>${suggestion.written}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function suffixesMatch(
  originalTokens: string[],
  originalStart: number,
  correctedTokens: string[],
  correctedStart: number
): boolean {
  const originalSuffix = originalTokens.slice(originalStart).map((token) => token.toLowerCase());
  const correctedSuffix = correctedTokens.slice(correctedStart).map((token) => token.toLowerCase());
  if (originalSuffix.length !== correctedSuffix.length) {
    return false;
  }

  return originalSuffix.every((token, index) => token === correctedSuffix[index]);
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? (prev[j - 1] ?? 0)
        : 1 + Math.min(prev[j] ?? 0, curr[j - 1] ?? 0, prev[j - 1] ?? 0);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j] ?? 0;
  }
  return prev[n] ?? 0;
}

function normalizedEditDistance(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  const maxLen = Math.max(al.length, bl.length);
  if (maxLen === 0) return 0;
  return editDistance(al, bl) / maxLen;
}
