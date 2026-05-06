export interface DictionarySuggestion {
  spoken: string;
  written: string;
}

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
    if (!spoken || !written || spoken === written) {
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

  return dedupeSuggestions(suggestions);
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
