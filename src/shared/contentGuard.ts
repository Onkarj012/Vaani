// Word guard for LLM formatting. Compares the words of the formatter input and
// output, in order and in any script. Punctuation, capitals, and layout are ignored.
// Filler words may disappear. Spoken layout and list cues ("new paragraph",
// "point one") may disappear only when the output visibly applies them.

const FILLER_WORDS = new Set(["um", "uh"]);

const LINE_BREAK_CUE_RE = /\b(new\s+paragraph|new\s+line|next\s+line)\b/gi;
const ENUM_CUE_RE = /\b(bullet\s*point|number\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|no\.\s*\d+|point\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|item\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|(first|second|third|fourth|fifth)\s+(item|bullet|point|step))\b/gi;
const LIST_MARKER_RE = /(?:^|\n)[ \t]*(?:[-*•]|\d+[.)])[ \t]+/g;
const REASONING_BLOCK_RE = /<(think|thinking|reasoning|thought)>[\s\S]*?<\/\1>/gi;
const UNCLOSED_REASONING_RE = /<(think|thinking|reasoning|thought)>[\s\S]*$/i;
const WORD_RE = /[\p{L}\p{M}\p{N}]+/gu;

const NUMBER_WORDS: ReadonlyMap<string, string> = new Map(Object.entries({
  zero: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
  fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
  twenty: "20", thirty: "30", forty: "40", fifty: "50",
  sixty: "60", seventy: "70", eighty: "80", ninety: "90",
  hundred: "100", thousand: "1000",
}));

export interface ContentWordDiff {
  missing: string[];
  added: string[];
}

// Removes reasoning blocks such as <think>...</think> from a formatter reply.
export function stripReasoningBlocks(text: string): string {
  return text.replace(REASONING_BLOCK_RE, "").replace(UNCLOSED_REASONING_RE, "").trim();
}

// Lowercases a word and maps spelled-out numbers to digits.
function normalizeWord(word: string): string {
  const lower = word.toLowerCase();
  return NUMBER_WORDS.get(lower) ?? lower;
}

// Splits text into normalized words, dropping filler words.
function wordsOf(text: string): string[] {
  return (text.match(WORD_RE) ?? []).map(normalizeWord).filter(word => !FILLER_WORDS.has(word));
}

// Input words, without the spoken cues that the output applies.
function inputWords(rawText: string, candidate: string): string[] {
  let text = rawText;
  if (candidate.includes("\n")) text = text.replace(LINE_BREAK_CUE_RE, " ");
  if (candidate.search(LIST_MARKER_RE) !== -1) text = text.replace(ENUM_CUE_RE, " ");
  return wordsOf(text);
}

// Output words, without list markers when the input dictated a list.
function outputWords(rawText: string, candidate: string): string[] {
  const dictatedList = rawText.search(ENUM_CUE_RE) !== -1;
  return wordsOf(dictatedList ? candidate.replace(LIST_MARKER_RE, " ") : candidate);
}

// Aligns two word sequences in order. Input words outside the longest common subsequence are missing; output words outside it are added.
function alignWords(source: string[], output: string[]): ContentWordDiff {
  const width = output.length + 1;
  const common = new Uint16Array((source.length + 1) * width);
  const cell = (i: number, j: number): number => common[i * width + j] ?? 0;
  for (let i = 1; i <= source.length; i += 1) {
    for (let j = 1; j <= output.length; j += 1) {
      common[i * width + j] = source[i - 1] === output[j - 1]
        ? cell(i - 1, j - 1) + 1
        : Math.max(cell(i - 1, j), cell(i, j - 1));
    }
  }

  const missing: string[] = [];
  const added: string[] = [];
  let i = source.length;
  let j = output.length;
  while (i > 0 || j > 0) {
    const sourceWord = source[i - 1];
    const outputWord = output[j - 1];
    if (sourceWord !== undefined && sourceWord === outputWord) {
      i -= 1;
      j -= 1;
    } else if (outputWord !== undefined && (sourceWord === undefined || cell(i, j - 1) >= cell(i - 1, j))) {
      added.push(outputWord);
      j -= 1;
    } else if (sourceWord !== undefined) {
      missing.push(sourceWord);
      i -= 1;
    }
  }
  return { missing: missing.reverse(), added: added.reverse() };
}

// Words the formatter dropped, reordered, or added between its input and output.
export function diffContentWords(rawText: string, candidate: string): ContentWordDiff {
  return alignWords(inputWords(rawText, candidate), outputWords(rawText, candidate));
}

// True only when the formatter kept every word, in order, and added none.
export function preservesContentWords(rawText: string, candidate: string): boolean {
  const { missing, added } = diffContentWords(rawText, candidate);
  return missing.length === 0 && added.length === 0;
}

// Input words the formatter dropped or reordered.
export function missingContentWords(rawText: string, candidate: string): string[] {
  return diffContentWords(rawText, candidate).missing;
}

// Output words the formatter added or moved.
export function addedContentWords(rawText: string, candidate: string): string[] {
  return diffContentWords(rawText, candidate).added;
}
