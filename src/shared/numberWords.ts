const NUMBER_ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};

const NUMBER_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

export const NUMBER_WORDS = [...Object.keys(NUMBER_ONES), ...Object.keys(NUMBER_TENS), "hundred"]
  .sort((a, b) => b.length - a.length);

export function parseNumberWords(phrase: string): number | null {
  const tokens = phrase.toLowerCase().split(/[\s-]+/).filter(t => t && t !== "and");
  if (tokens.length === 0) return null;
  let total = 0;
  let current = 0;
  for (const token of tokens) {
    const ones = NUMBER_ONES[token];
    const tens = NUMBER_TENS[token];
    if (ones !== undefined) {
      current += ones;
    } else if (tens !== undefined) {
      current += tens;
    } else if (token === "hundred") {
      current = (current || 1) * 100;
    } else {
      return null;
    }
  }
  return total + current;
}

export function digitizeNumberWords(phrase: string): string | null {
  const normalized = phrase.toLowerCase().replace(/[\s-]+/g, " ").trim();
  if (!normalized) return null;
  const pattern = new RegExp(`^(?:${NUMBER_WORDS.join("|")})(?:\\s+(?:and\\s+)?(?:${NUMBER_WORDS.join("|")}))*$`, "i");
  if (!pattern.test(normalized)) return null;
  const value = parseNumberWords(normalized);
  return value === null ? null : String(value);
}
