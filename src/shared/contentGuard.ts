// Word guard for LLM formatting. Compares the words of the formatter input and output,
// in order and in any script. Punctuation, capitals, and line placement are ignored.
// Filler words may disappear. Spoken layout cues ("new paragraph", "point one") may
// disappear only when the output has a line break or a list item with the same number there.

const LINE_CUE_SOURCE = String.raw`new\s+paragraph|new\s+line|next\s+line`;
const NUMBER_WORD_SOURCE = String.raw`one|two|three|four|five|six|seven|eight|nine|ten|\d+`;
const ENUM_CUE_SOURCE = String.raw`bullet\s*point|number\s+(?:${NUMBER_WORD_SOURCE})|no\.\s*\d+|point\s+(?:${NUMBER_WORD_SOURCE})|item\s+(?:${NUMBER_WORD_SOURCE})|(?:first|second|third|fourth|fifth)\s+(?:item|bullet|point|step)`;
const NUMERIC_LITERAL_SOURCE = String.raw`\p{N}+(?:[.,:/]\p{N}+)+`;
const WORD_SOURCE = String.raw`[\p{L}\p{M}\p{N}]+`;
const INPUT_TOKEN_RE = new RegExp(
  String.raw`\b(?<line>${LINE_CUE_SOURCE})\b|\b(?<enum>${ENUM_CUE_SOURCE})\b|${NUMERIC_LITERAL_SOURCE}|${WORD_SOURCE}`,
  "giu",
);
const OUTPUT_TOKEN_RE = new RegExp(
  String.raw`(?:^|\n)[ \t]*(?:(?<bullet>[-*•])|(?<number>\d+)[.)])[ \t]+|(?<break>\n)|${NUMERIC_LITERAL_SOURCE}|${WORD_SOURCE}`,
  "gu",
);
const REASONING_BLOCK_RE = /<(think|thinking|reasoning|thought)>[\s\S]*?<\/\1>/gi;
const UNCLOSED_REASONING_RE = /<(think|thinking|reasoning|thought)>[\s\S]*$/i;
const WORD_RE = /[\p{L}\p{M}\p{N}]+/gu;
const FILLER_WORDS = new Set(["um", "uh"]);

const NUMBER_WORDS: ReadonlyMap<string, string> = new Map(Object.entries({
  zero: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
  fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
  twenty: "20", thirty: "30", forty: "40", fifty: "50",
  sixty: "60", seventy: "70", eighty: "80", ninety: "90",
  hundred: "100", thousand: "1000",
}));

const ORDINAL_NUMBERS: ReadonlyMap<string, string> = new Map([
  ["first", "1"], ["second", "2"], ["third", "3"], ["fourth", "4"], ["fifth", "5"],
]);

export interface ContentWordDiff {
  missing: string[];
  added: string[];
}

// One piece of input or output: a word, a spoken layout cue, a line break, or a list item.
type Unit =
  | { kind: "word"; text: string }
  | { kind: "line"; words: string[] }
  | { kind: "enum"; value: string | null; words: string[] }
  | { kind: "break" }
  | { kind: "item"; value: string | null };

// Removes reasoning blocks such as <think>...</think> from a formatter reply.
export function stripReasoningBlocks(text: string): string {
  return text.replace(REASONING_BLOCK_RE, "").replace(UNCLOSED_REASONING_RE, "").trim();
}

// Lowercased words in a piece of text.
function wordsIn(text: string): string[] {
  return (text.match(WORD_RE) ?? []).map(word => word.toLowerCase());
}

// The list number a spoken cue names, or null for an unnumbered cue such as "bullet point".
function cueValue(cue: string): string | null {
  for (const word of wordsIn(cue)) {
    const number = ORDINAL_NUMBERS.get(word) ?? NUMBER_WORDS.get(word) ?? (/^\d+$/.test(word) ? word : undefined);
    if (number) return number;
  }
  return null;
}

// True when a unit is a spelled-out number word.
function isNumberWord(unit: Unit | undefined): boolean {
  return unit?.kind === "word" && NUMBER_WORDS.has(unit.text);
}

// Drops filler words, then maps standalone spelled-out numbers to digits. "twenty one" stays words so it never matches "20 1".
function finishWords(units: Unit[]): Unit[] {
  const kept = units.filter(unit => unit.kind !== "word" || !FILLER_WORDS.has(unit.text));
  return kept.map((unit, index) => {
    if (unit.kind !== "word") return unit;
    const digits = NUMBER_WORDS.get(unit.text);
    if (!digits || isNumberWord(kept[index - 1]) || isNumberWord(kept[index + 1])) return unit;
    return { kind: "word", text: digits };
  });
}

// Input words and spoken layout cues in order. Numeric literals such as 1.5 stay whole.
function inputUnits(text: string): Unit[] {
  return finishWords([...text.matchAll(INPUT_TOKEN_RE)].map((match): Unit => {
    if (match.groups?.line) return { kind: "line", words: wordsIn(match[0]) };
    if (match.groups?.enum) return { kind: "enum", value: cueValue(match[0]), words: wordsIn(match[0]) };
    return { kind: "word", text: match[0].toLowerCase() };
  }));
}

// Output words, line breaks, and list items in order. Numeric literals such as 1.5 stay whole.
function outputUnits(text: string): Unit[] {
  return finishWords([...text.matchAll(OUTPUT_TOKEN_RE)].map((match): Unit => {
    if (match.groups?.break) return { kind: "break" };
    if (match.groups?.number) return { kind: "item", value: match.groups.number };
    if (match.groups?.bullet) return { kind: "item", value: null };
    return { kind: "word", text: match[0].toLowerCase() };
  }));
}

// True when an output unit applies an input unit: the same word, a line break for a line cue, or a list item with the same number.
function sameUnit(source: Unit, output: Unit): boolean {
  if (source.kind === "word") return output.kind === "word" && output.text === source.text;
  if (source.kind === "line") return output.kind === "break";
  if (source.kind === "enum") return output.kind === "item" && output.value === source.value;
  return false;
}

// Words a unit contributes to the missing or added list. Line breaks have none.
function unitWords(unit: Unit): string[] {
  switch (unit.kind) {
    case "word": return [unit.text];
    case "line":
    case "enum": return unit.words;
    case "break": return [];
    case "item": return unit.value ? [unit.value] : [];
  }
}

// Aligns input and output units in order. Unmatched input units are missing; unmatched output units are added.
function alignUnits(source: Unit[], output: Unit[]): ContentWordDiff {
  const width = output.length + 1;
  const common = new Uint16Array((source.length + 1) * width);
  const cell = (i: number, j: number): number => common[i * width + j] ?? 0;
  for (let i = 1; i <= source.length; i += 1) {
    for (let j = 1; j <= output.length; j += 1) {
      const sourceUnit = source[i - 1];
      const outputUnit = output[j - 1];
      common[i * width + j] = sourceUnit && outputUnit && sameUnit(sourceUnit, outputUnit)
        ? cell(i - 1, j - 1) + 1
        : Math.max(cell(i - 1, j), cell(i, j - 1));
    }
  }

  const missingUnits: Unit[] = [];
  const addedUnits: Unit[] = [];
  let i = source.length;
  let j = output.length;
  while (i > 0 || j > 0) {
    const sourceUnit = source[i - 1];
    const outputUnit = output[j - 1];
    if (sourceUnit && outputUnit && sameUnit(sourceUnit, outputUnit)) {
      i -= 1;
      j -= 1;
    } else if (outputUnit && (!sourceUnit || cell(i, j - 1) >= cell(i - 1, j))) {
      addedUnits.push(outputUnit);
      j -= 1;
    } else if (sourceUnit) {
      missingUnits.push(sourceUnit);
      i -= 1;
    }
  }
  return {
    missing: missingUnits.reverse().flatMap(unitWords),
    added: addedUnits.reverse().flatMap(unitWords),
  };
}

// Words the formatter dropped, reordered, or added between its input and output.
export function diffContentWords(rawText: string, candidate: string): ContentWordDiff {
  return alignUnits(inputUnits(rawText), outputUnits(candidate));
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
