// Word guard for LLM formatting. Compares the words of the formatter input and output,
// in order and in any script. Punctuation, capitals, and line placement are ignored.
// Listed filler words may disappear, but only when the output drops them. Spoken layout cues ("new paragraph", "point one") may
// disappear only when the output has a line break or a list item with the same number there, or keeps the cue words.

const LINE_CUE_SOURCE = String.raw`new\s+paragraph|new\s+line|next\s+line`;
const NUMBER_WORD_SOURCE = String.raw`one|two|three|four|five|six|seven|eight|nine|ten|\d+`;
// A cue whose number starts a longer literal such as "1.5" is not a cue.
const ENUM_CUE_SOURCE = String.raw`(?:bullet\s*point|number\s+(?:${NUMBER_WORD_SOURCE})|no\.\s*\d+|point\s+(?:${NUMBER_WORD_SOURCE})|item\s+(?:${NUMBER_WORD_SOURCE})|(?:first|second|third|fourth|fifth)\s+(?:item|bullet|point|step))(?![.,:/]\p{N})`;
// A sign, with a currency symbol before or after it, or a leading dot is part of the literal only when no letter or digit comes right before it.
const NUMERIC_LITERAL_SOURCE = String.raw`(?<![\p{L}\p{M}\p{N}])(?:[+-]\p{Sc}?|\p{Sc}[+-])\p{N}+(?:[.,:/]\p{N}+)*|(?<![\p{L}\p{M}\p{N}])[+-]?\.\p{N}+|\p{N}+(?:[.,:/]\p{N}+)+`;
const WORD_SOURCE = String.raw`[\p{L}\p{M}\p{N}]+`;
const INPUT_TOKEN_RE = new RegExp(
  String.raw`\b(?<line>${LINE_CUE_SOURCE})\b|\b(?<enum>${ENUM_CUE_SOURCE})\b|(?:${NUMERIC_LITERAL_SOURCE})|${WORD_SOURCE}`,
  "giu",
);
const OUTPUT_TOKEN_RE = new RegExp(
  String.raw`(?:^|\n)[ \t]*(?:(?<bullet>[-*•])|(?<number>\d+)[.)])[ \t]+|(?<break>\n)|(?:${NUMERIC_LITERAL_SOURCE})|${WORD_SOURCE}`,
  "gu",
);
const REASONING_BLOCK_RE = /<(think|thinking|reasoning|thought)>[\s\S]*?<\/\1>/gi;
const UNCLOSED_REASONING_RE = /<(think|thinking|reasoning|thought)>[\s\S]*$/i;
const WORD_RE = /[\p{L}\p{M}\p{N}]+/gu;
const CURRENCY_RE = /\p{Sc}/gu;

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

// Largest alignment table the guard builds. Longer diffs are rejected instead of aligned.
const MAX_ALIGN_CELLS = 1_000_000;
const TOO_LONG_REASON = "Transcript too long to verify formatting.";

export interface ContentWordDiff {
  missing: string[];
  added: string[];
  // Set when the words could not be compared. The formatter output is then unverified.
  rejection?: string;
}

// One piece of input or output: a word, a listed filler, a spoken layout cue, a line break, or a list item.
type Unit =
  | { kind: "word"; text: string }
  | { kind: "filler"; text: string }
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

// Lowercased token text without currency symbols, so "-$10" and "-10" compare equal.
function tokenText(text: string): string {
  return text.toLowerCase().replace(CURRENCY_RE, "");
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

// True when a unit is the given word.
function isWord(unit: Unit | undefined, text: string): boolean {
  return unit?.kind === "word" && unit.text === text;
}

// Marks listed fillers and filler phrases in the input as fillers. Returns the index range of each matched phrase.
function markFillers(units: Unit[], fillers: readonly string[]): { units: Unit[]; phrases: [number, number][] } {
  const marked = new Set<number>();
  const phrases: [number, number][] = [];
  for (const filler of fillers) {
    const phrase = wordsIn(filler);
    if (phrase.length === 0) continue;
    for (let start = 0; start + phrase.length <= units.length; start += 1) {
      if (!phrase.every((word, offset) => isWord(units[start + offset], word))) continue;
      phrases.push([start, start + phrase.length]);
      for (let offset = 0; offset < phrase.length; offset += 1) marked.add(start + offset);
    }
  }
  return {
    units: units.map((unit, index): Unit => (marked.has(index) && unit.kind === "word" ? { kind: "filler", text: unit.text } : unit)),
    phrases,
  };
}

// Maps standalone spelled-out numbers to digits, skipping fillers when looking at neighbors. "twenty one" stays words so it never matches "20 1".
function finishWords(units: Unit[]): Unit[] {
  const neighbor = (index: number, step: -1 | 1): Unit | undefined => {
    let i = index + step;
    while (units[i]?.kind === "filler") i += step;
    return units[i];
  };
  return units.map((unit, index) => {
    if (unit.kind !== "word") return unit;
    const digits = NUMBER_WORDS.get(unit.text);
    if (!digits || isNumberWord(neighbor(index, -1)) || isNumberWord(neighbor(index, 1))) return unit;
    return { kind: "word", text: digits };
  });
}

// Input units in order, plus the index range of each listed filler phrase. Numeric literals such as 1.5 stay whole.
function inputUnits(text: string, fillers: readonly string[]): { units: Unit[]; phrases: [number, number][] } {
  const units = [...text.matchAll(INPUT_TOKEN_RE)].map((match): Unit => {
    if (match.groups?.line) return { kind: "line", words: wordsIn(match[0]) };
    if (match.groups?.enum) return { kind: "enum", value: cueValue(match[0]), words: wordsIn(match[0]) };
    return { kind: "word", text: tokenText(match[0]) };
  });
  const marked = markFillers(units, fillers);
  return { units: finishWords(marked.units), phrases: marked.phrases };
}

// Output words, line breaks, and list items in order. Numeric literals such as 1.5 stay whole.
function outputUnits(text: string): Unit[] {
  return finishWords([...text.matchAll(OUTPUT_TOKEN_RE)].map((match): Unit => {
    if (match.groups?.break) return { kind: "break" };
    if (match.groups?.number) return { kind: "item", value: match.groups.number };
    if (match.groups?.bullet) return { kind: "item", value: null };
    return { kind: "word", text: tokenText(match[0]) };
  }));
}

// True when an output word is a cue word. A spelled-out number may come back as digits.
function sameCueWord(cueWord: string, outputWord: string): boolean {
  return outputWord === cueWord || outputWord === NUMBER_WORDS.get(cueWord);
}

// True when an output unit shows a layout cue: a line break for a line cue, or a list item with the cue's number.
function showsLayout(cue: Unit, output: Unit): boolean {
  if (cue.kind === "line") return output.kind === "break";
  if (cue.kind === "enum") return output.kind === "item" && output.value === cue.value;
  return false;
}

// Number of output units that the cue words fill when they appear unchanged just before end, or 0.
function cueWordsCountAt(words: string[], output: Unit[], end: number): number {
  const start = end - words.length;
  if (words.length === 0 || start < 0) return 0;
  const matches = words.every((word, offset) => {
    const unit = output[start + offset];
    return unit?.kind === "word" && sameCueWord(word, unit.text);
  });
  return matches ? words.length : 0;
}

// Number of output units, ending just before end, that a source unit accounts for. Zero means no match there.
function consumedBy(source: Unit, output: Unit[], end: number): number {
  const last = output[end - 1];
  if (!last) return 0;
  if (source.kind === "word" || source.kind === "filler") return last.kind === "word" && last.text === source.text ? 1 : 0;
  if (source.kind !== "line" && source.kind !== "enum") return 0;
  if (showsLayout(source, last)) return 1;
  return cueWordsCountAt(source.words, output, end);
}

// Words a unit contributes to the missing or added list. Line breaks have none.
function unitWords(unit: Unit): string[] {
  switch (unit.kind) {
    case "word":
    case "filler": return [unit.text];
    case "line":
    case "enum": return unit.words;
    case "break": return [];
    case "item": return unit.value ? [unit.value] : [];
  }
}

// True when a source unit and an output unit are the same single word, so pairing them never costs a match.
function sameWordUnit(source: Unit | undefined, output: Unit | undefined): boolean {
  return (source?.kind === "word" || source?.kind === "filler") && output?.kind === "word" && output.text === source.text;
}

// Unmatched source indices and added output units for two sections, or null when the table would exceed MAX_ALIGN_CELLS.
function alignSections(source: Unit[], output: Unit[]): { dropped: number[]; added: Unit[] } | null {
  if ((source.length + 1) * (output.length + 1) > MAX_ALIGN_CELLS) return null;
  const width = output.length + 1;
  const common = new Uint16Array((source.length + 1) * width);
  const cell = (i: number, j: number): number => common[i * width + j] ?? 0;
  for (let i = 1; i <= source.length; i += 1) {
    const sourceUnit = source[i - 1];
    for (let j = 1; j <= output.length; j += 1) {
      const consumed = sourceUnit ? consumedBy(sourceUnit, output, j) : 0;
      common[i * width + j] = Math.max(cell(i - 1, j), cell(i, j - 1), consumed > 0 ? cell(i - 1, j - consumed) + 1 : 0);
    }
  }

  const dropped: number[] = [];
  const added: Unit[] = [];
  let i = source.length;
  let j = output.length;
  while (i > 0 || j > 0) {
    const sourceUnit = source[i - 1];
    const outputUnit = output[j - 1];
    const consumed = sourceUnit && j > 0 ? consumedBy(sourceUnit, output, j) : 0;
    if (consumed > 0 && cell(i, j) === cell(i - 1, j - consumed) + 1) {
      i -= 1;
      j -= consumed;
    } else if (outputUnit && (!sourceUnit || cell(i, j - 1) >= cell(i - 1, j))) {
      added.push(outputUnit);
      j -= 1;
    } else {
      dropped.push(i - 1);
      i -= 1;
    }
  }
  return { dropped, added: added.reverse() };
}

// Aligns input and output units in order. Unmatched input units are missing unless they belong to a filler phrase that was dropped whole; unmatched output units are added.
function alignUnits(source: Unit[], phrases: [number, number][], output: Unit[]): ContentWordDiff {
  // Equal words at both ends align without a table, so an unchanged long transcript costs nothing.
  let head = 0;
  while (head < source.length && head < output.length && sameWordUnit(source[head], output[head])) head += 1;
  let tail = 0;
  while (tail < source.length - head && tail < output.length - head
    && sameWordUnit(source[source.length - 1 - tail], output[output.length - 1 - tail])) tail += 1;

  const middle = alignSections(source.slice(head, source.length - tail), output.slice(head, output.length - tail));
  if (!middle) return { missing: [], added: [], rejection: TOO_LONG_REASON };

  const dropped = new Set(middle.dropped.map(index => index + head));
  // A filler phrase may go only when every one of its words goes.
  const dropsWholePhrase = ([start, end]: [number, number]): boolean => {
    for (let index = start; index < end; index += 1) if (!dropped.has(index)) return false;
    return true;
  };
  const isExempt = (index: number): boolean => phrases.some(phrase => phrase[0] <= index && index < phrase[1] && dropsWholePhrase(phrase));
  return {
    missing: source.filter((_, index) => dropped.has(index) && !isExempt(index)).flatMap(unitWords),
    added: middle.added.flatMap(unitWords),
  };
}

// Words the formatter dropped, reordered, or added. Listed fillers may be dropped but not added.
export function diffContentWords(rawText: string, candidate: string, fillers: readonly string[] = []): ContentWordDiff {
  const input = inputUnits(rawText, fillers);
  return alignUnits(input.units, input.phrases, outputUnits(candidate));
}

// True only when the formatter kept every word, in order, and added none. Listed fillers may be dropped.
export function preservesContentWords(rawText: string, candidate: string, fillers: readonly string[] = []): boolean {
  const { missing, added, rejection } = diffContentWords(rawText, candidate, fillers);
  return rejection === undefined && missing.length === 0 && added.length === 0;
}

// Input words the formatter dropped or reordered, ignoring listed fillers.
export function missingContentWords(rawText: string, candidate: string, fillers: readonly string[] = []): string[] {
  return diffContentWords(rawText, candidate, fillers).missing;
}

// Output words the formatter added or moved.
export function addedContentWords(rawText: string, candidate: string, fillers: readonly string[] = []): string[] {
  return diffContentWords(rawText, candidate, fillers).added;
}
