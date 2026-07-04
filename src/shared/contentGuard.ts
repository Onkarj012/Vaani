// Anti-condense guard: verify every content word from the raw transcript
// survives in the LLM-formatted candidate, order-independent and count-aware.
// Filler words are excluded from the required multiset. Spoken formatting cue
// words are excluded only when the candidate visibly applies that formatting.
// Number word to digit differences and case/punctuation differences are ignored.

const FILLER_WORDS = new Set([
  "um", "uh",
]);

const LINE_BREAK_CUE_RE = /\b(new\s+paragraph|new\s+line|next\s+line)\b/gi;
const ENUM_CUE_RE = /\b(bullet\s*point|number\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|no\.\s*\d+|point\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|item\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|(first|second|third|fourth|fifth)\s+(item|bullet|point|step))\b/gi;
const LIST_MARKER_RE = /(?:^|\n)\s*(?:[-*•]\s+|\d+[.)]\s+)/;
const PURE_NUMBER_RE = /^\d+$/;

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
  fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
  twenty: "20", thirty: "30", forty: "40", fifty: "50",
  sixty: "60", seventy: "70", eighty: "80", ninety: "90",
  hundred: "100", thousand: "1000",
};

const CUE_WORDS = new Set(tokenizeText([
  "new paragraph new line next line",
  "bullet point number no point item",
  "first second third fourth fifth",
  "item bullet point step",
  "one two three four five six seven eight nine ten",
].join(" ")));

function normalizeToken(token: string): string {
  const lower = token.toLowerCase();
  return NUMBER_WORDS[lower] ?? lower;
}

function tokenizeText(text: string): string[] {
  return text
    .split(/\s+/)
    .map(t => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "").toLowerCase())
    .filter(t => t.length > 0)
    .map(normalizeToken);
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function extractContentWords(
  text: string,
  options: { ignoreLineBreakCues: boolean; ignoreEnumCues: boolean }
): Map<string, number> {
  let stripped = text;
  if (options.ignoreLineBreakCues) {
    stripped = stripped.replace(LINE_BREAK_CUE_RE, " ");
  }
  if (options.ignoreEnumCues) {
    stripped = stripped.replace(ENUM_CUE_RE, " ");
  }
  stripped = stripped.replace(/\s{2,}/g, " ");
  const tokens = tokenizeText(stripped).filter(t => !FILLER_WORDS.has(t));
  return countTokens(tokens);
}

function candidateFormatting(candidate: string): { ignoreLineBreakCues: boolean; ignoreEnumCues: boolean } {
  return {
    ignoreLineBreakCues: candidate.includes("\n"),
    ignoreEnumCues: LIST_MARKER_RE.test(candidate),
  };
}

export function preservesContentWords(rawText: string, candidate: string): boolean {
  return missingContentWords(rawText, candidate).length === 0;
}

export function missingContentWords(rawText: string, candidate: string): string[] {
  const required = extractContentWords(rawText, candidateFormatting(candidate));
  if (required.size === 0) return [];

  const present = countTokens(tokenizeText(candidate));
  const missing: string[] = [];

  for (const [word, requiredCount] of required) {
    const presentCount = present.get(word) ?? 0;
    for (let count = presentCount; count < requiredCount; count += 1) {
      missing.push(word);
    }
  }
  return missing;
}

export function addedContentWords(rawText: string, candidate: string): string[] {
  const expected = extractContentWords(rawText, {
    ignoreLineBreakCues: true,
    ignoreEnumCues: true,
  });
  const added: string[] = [];

  for (const word of tokenizeText(candidate)) {
    if (PURE_NUMBER_RE.test(word) || FILLER_WORDS.has(word) || CUE_WORDS.has(word)) {
      continue;
    }

    const expectedCount = expected.get(word) ?? 0;
    if (expectedCount > 0) {
      expected.set(word, expectedCount - 1);
    } else {
      added.push(word);
    }
  }

  return added;
}
