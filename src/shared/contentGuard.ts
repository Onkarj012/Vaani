// Anti-condense guard: verify every content word from the raw transcript
// survives in the LLM-formatted candidate, order-independent. Filler words and
// spoken list-cue words are excluded from the required set. Number-word↔digit
// differences and case/punctuation differences are ignored.

const FILLER_WORDS = new Set([
  "um", "uh", "like", "you", "know", "sort", "of", "kind", "basically",
  "literally", "actually", "so", "well", "right", "okay", "ok",
]);

const SPOKEN_CUE_RE = /\b(bullet\s*point|new\s+paragraph|new\s+line|next\s+line|number\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|no\.\s*\d+|point\s+\d+|item\s+\d+|(first|second|third|fourth|fifth)\s+(item|bullet|point|step))\b/gi;

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
  fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
  twenty: "20", thirty: "30", forty: "40", fifty: "50",
  sixty: "60", seventy: "70", eighty: "80", ninety: "90",
  hundred: "100", thousand: "1000",
};

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

function extractContentWords(text: string): Set<string> {
  const stripped = text.replace(SPOKEN_CUE_RE, " ").replace(/\s{2,}/g, " ");
  const tokens = tokenizeText(stripped).filter(t => !FILLER_WORDS.has(t));
  return new Set(tokens);
}

export function preservesContentWords(rawText: string, candidate: string): boolean {
  const required = extractContentWords(rawText);
  if (required.size === 0) return true;

  const present = new Set(tokenizeText(candidate));

  for (const word of required) {
    if (!present.has(word)) return false;
  }
  return true;
}
