// Word guard for LLM formatting. Compares the words of the formatter input and output,
// in order and in any script. Punctuation, capitals, and line placement are ignored.
// judgeFormatterReply turns the comparison into a verdict. With cleanup on it is loose: it rejects only an added
// sentence, a large drop, or a changed number or negation. With cleanup off every word must stay.
// The rules below decide which dropped words are explained, so they never count against the reply.
// A Devanagari word may come back in Roman letters when it sounds alike ("कैंसल" → "cancel").
// With speech noise allowed, these may also be dropped: a stutter next to a kept copy ("the, the", "on the, on the"),
// a cut-off word ("ru-", or a short fragment the next word starts with), and up to four words replaced right after a
// correction cue ("Arjun, sorry, Aditya"), and a sentence withdrawn by "scratch that" or "delete that" along with that cue.
// Negations and numbers are never cut-off words or bare cues. Any other dropped
// word, and any added word, is a change.
// Listed filler words may disappear, but only when the output drops them. Spoken layout cues ("new paragraph", "point one",
// a sentence-opening "First,") may disappear only when the output has a line break or a list item with the same number there,
// or keeps the cue words.

import { dropScratchedSentences } from "./scratchThat";
import { isDevanagariNumberWord, isDevanagariWord, soundsAlike } from "./scriptMatch";

const LINE_CUE_SOURCE = String.raw`new\s+paragraph|new\s+line|next\s+line`;
const NUMBER_WORD_SOURCE = String.raw`one|two|three|four|five|six|seven|eight|nine|ten|\d+`;
const ORDINAL_SOURCE = String.raw`first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth`;
// An ordinal that opens a sentence ("First, Siddharth should…") is a list cue on its own.
const BARE_ORDINAL_SOURCE = String.raw`(?<=(?:^|[.!?:;\n।॥])[ \t]*)(?:${ORDINAL_SOURCE}|firstly|secondly|thirdly)`;
// A cue whose number starts a longer literal such as "1.5" is not a cue.
const ENUM_CUE_SOURCE = String.raw`(?:bullet\s*point|number\s+(?:${NUMBER_WORD_SOURCE})|no\.\s*\d+|point\s+(?:${NUMBER_WORD_SOURCE})|item\s+(?:${NUMBER_WORD_SOURCE})|(?:${ORDINAL_SOURCE})\s+(?:item|bullet|point|step)|${BARE_ORDINAL_SOURCE})(?![.,:/]\p{N})`;
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
const CAMEL_CASE_RE = /\p{L}*\p{Ll}\p{Lu}\p{L}*/gu;

// Hesitation sounds. Cleanup adds them to the filler words it removes.
// "er" and "ah" are left out: they are words in other languages ("Er ist da").
export { HESITATION_WORDS } from "./scratchThat";
// Phrases that mark the speaker correcting what came just before, longest first.
const CORRECTION_CUES: readonly (readonly string[])[] = [["scratch", "that"], ["or", "rather"], ["no", "wait"], ["i", "mean"], ["sorry"], ["wait"], ["actually"], ["rather"], ["no"]];
const MAX_REPLACED_WORDS = 4;
const MAX_STUTTER_PHRASE = 3;
const MAX_CUT_FRAGMENT = 3;
// Words whose loss flips meaning. They are never cut-off fragments or droppable lone cues.
export const PROTECTED_WORDS: ReadonlySet<string> = new Set([
  "no", "not", "nor", "never", "none", "nothing", "don", "didn", "doesn", "won", "can", "cannot", "isn", "aren", "wasn", "weren",
  "shouldn", "wouldn", "couldn", "haven", "hasn", "hadn", "mustn", "nahi", "nahin", "na", "mat", "nako",
  "नहीं", "नही", "न", "ना", "मत", "नाही", "नको",
]);
// Cut-off marker right after a word: "ru- run", "trans-- uh". Em and en dashes are punctuation, not cut-offs.
const CUT_OFF_RE = /^-{1,2}(?=[\s,.!?]|$)/u;

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
  ["sixth", "6"], ["seventh", "7"], ["eighth", "8"], ["ninth", "9"], ["tenth", "10"],
  ["eleventh", "11"], ["twelfth", "12"], ["thirteenth", "13"], ["fourteenth", "14"], ["fifteenth", "15"],
  ["sixteenth", "16"], ["seventeenth", "17"], ["eighteenth", "18"], ["nineteenth", "19"], ["twentieth", "20"],
  ["thirtieth", "30"], ["firstly", "1"], ["secondly", "2"], ["thirdly", "3"],
]);
// Single words that open a correction ("3.5, no, 4.5"), for the guard path that cannot align.
const CORRECTION_CUE_WORDS: ReadonlySet<string> = new Set(["no", "wait", "sorry", "actually", "rather", "mean"]);

// Largest alignment table the guard builds. Longer diffs are compared as word counts instead.
const MAX_ALIGN_CELLS = 1_000_000;
const TOO_LONG_REASON = "Transcript too long to verify formatting.";
// With cleanup on, a reply may add at most this many words the speaker never said, and drop at most this share.
const MAX_NEW_WORDS = 2;
const MAX_DROPPED_SHARE = 0.25;
export const CHANGED_WORDS_REASON = "The formatter changed words in the transcript.";
const ADDED_WORDS_REASON = "The formatter added words the speaker did not say.";
const DROPPED_WORDS_REASON = "The formatter dropped too many words.";
const CHANGED_MEANING_REASON = "The formatter changed a number or a negation.";

export interface ContentWordDiff {
  missing: string[];
  added: string[];
  // Set when the words could not be compared. The formatter output is then unverified.
  rejection?: string;
}

// One piece of input or output: a word, a listed filler, a spoken layout cue, a line break, or a list item.
type Unit =
  | { kind: "word"; text: string; cut?: boolean; pause?: boolean; boundary?: boolean }
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

// True when an output word is the input word, or the same Devanagari word written in Roman letters.
function sameWord(source: string, output: string): boolean {
  return output === source || (isDevanagariWord(source) && soundsAlike(source, output));
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
    return { ...unit, text: digits };
  });
}

// Input units in order, plus the index range of each listed filler phrase. Numeric literals such as 1.5 stay whole.
function inputUnits(text: string, fillers: readonly string[]): { units: Unit[]; phrases: [number, number][] } {
  const units = [...text.matchAll(INPUT_TOKEN_RE)].map((match): Unit => {
    if (match.groups?.line) return { kind: "line", words: wordsIn(match[0]) };
    if (match.groups?.enum) return { kind: "enum", value: cueValue(match[0]), words: wordsIn(match[0]) };
    const start = match.index ?? 0;
    const after = text.slice(start + match[0].length);
    const unit: Unit = { kind: "word", text: tokenText(match[0]) };
    if (/\p{L}/u.test(unit.text) && CUT_OFF_RE.test(after)) unit.cut = true;
    // A pause is punctuation right after the word; a boundary is a sentence end or line break right before it.
    if (/^(?:[,;:.!?…।॥]|-{2})/u.test(after)) unit.pause = true;
    if (/(?:^|[.!?।॥\n])[\s"'“‘(]*$/u.test(text.slice(0, start))) unit.boundary = true;
    return unit;
  });
  // "mm" after a number is a unit ("10 mm"), so it is not offered as a filler there.
  const marked = markFillers(units, fillers);
  const unitAfterNumber = (index: number): boolean => {
    const previous = unitText(units[index - 1]) ?? "";
    return unitText(units[index]) === "mm" && (/^\p{N}/u.test(previous) || NUMBER_WORDS.has(previous));
  };
  const phrases = marked.phrases.filter(([start]) => !unitAfterNumber(start));
  const markedUnits = marked.units.map((unit, index): Unit => (unit.kind === "filler" && unitAfterNumber(index) && !phrases.some(([start, end]) => start <= index && index < end) ? { kind: "word", text: unit.text } : unit));
  return { units: finishWords(markedUnits), phrases };
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
// A list item with the cue's number right before the kept words ("1. First, …") is part of the match.
function cueWordsCountAt(cue: Unit & { words: string[] }, output: Unit[], end: number): number {
  const { words } = cue;
  const start = end - words.length;
  if (words.length === 0 || start < 0) return 0;
  const matches = words.every((word, offset) => {
    const unit = output[start + offset];
    return unit?.kind === "word" && sameCueWord(word, unit.text);
  });
  if (!matches) return 0;
  const before = output[start - 1];
  return before && showsLayout(cue, before) ? words.length + 1 : words.length;
}

// True when an output unit keeps a source word. A spoken "7." that opens a line may come back as list item 7.
function keepsWord(source: string, output: Unit | undefined): boolean {
  if (output?.kind === "item") return output.value === source;
  return output?.kind === "word" && sameWord(source, output.text);
}

// Number of output units, ending just before end, that a source unit accounts for. Zero means no match there.
function consumedBy(source: Unit, output: Unit[], end: number): number {
  const last = output[end - 1];
  if (!last) return 0;
  if (source.kind === "word" || source.kind === "filler") return keepsWord(source.text, last) ? 1 : 0;
  if (source.kind !== "line" && source.kind !== "enum") return 0;
  if (showsLayout(source, last)) return 1;
  return cueWordsCountAt(source, output, end);
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
  return (source?.kind === "word" || source?.kind === "filler") && keepsWord(source.text, output);
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
function alignUnits(source: Unit[], phrases: [number, number][], output: Unit[], allowSpeechNoise: boolean): ContentWordDiff {
  // Equal words at both ends align without a table, so a long transcript with small edits stays cheap.
  // Whole filler phrases the output drops are skipped there too.
  const skipped: number[] = [];
  const skip = ([start, end]: [number, number]): void => { for (let index = start; index < end; index += 1) skipped.push(index); };
  let sourceHead = 0;
  let outputHead = 0;
  while (sourceHead < source.length) {
    if (outputHead < output.length && sameWordUnit(source[sourceHead], output[outputHead])) { sourceHead += 1; outputHead += 1; continue; }
    // Skip dropped filler phrases only when the words after them line up again.
    let next = sourceHead;
    const run: [number, number][] = [];
    for (let phrase = phrases.find(([start]) => start === next); phrase; phrase = phrases.find(([start]) => start === next)) {
      run.push(phrase);
      next = phrase[1];
    }
    const realigns = next === source.length
      ? outputHead === output.length
      : outputHead < output.length && sameWordUnit(source[next], output[outputHead]);
    if (run.length === 0 || !realigns) break;
    run.forEach(skip);
    sourceHead = next;
  }
  // A trim edge inside a filler phrase moves back, so the table judges the phrase whole.
  for (const [start, end] of phrases) {
    if (start < sourceHead && sourceHead < end) { outputHead -= sourceHead - start; sourceHead = start; }
  }
  let sourceTail = source.length;
  let outputTail = output.length;
  while (sourceTail > sourceHead) {
    if (outputTail > outputHead && sameWordUnit(source[sourceTail - 1], output[outputTail - 1])) { sourceTail -= 1; outputTail -= 1; continue; }
    let next = sourceTail;
    const run: [number, number][] = [];
    for (let phrase = phrases.find(([, end]) => end === next); phrase && phrase[0] >= sourceHead; phrase = phrases.find(([, end]) => end === next)) {
      run.push(phrase);
      next = phrase[0];
    }
    const realigns = next === sourceHead
      ? outputTail === outputHead
      : outputTail > outputHead && sameWordUnit(source[next - 1], output[outputTail - 1]);
    if (run.length === 0 || !realigns) break;
    run.forEach(skip);
    sourceTail = next;
  }
  for (const [start, end] of phrases) {
    if (start < sourceTail && sourceTail < end) { outputTail += end - sourceTail; sourceTail = end; }
  }

  const middle = alignSections(source.slice(sourceHead, sourceTail), output.slice(outputHead, outputTail));
  if (!middle) return { missing: [], added: [], rejection: TOO_LONG_REASON };

  const dropped = new Set([...skipped, ...middle.dropped.map(index => index + sourceHead)]);
  // A filler phrase may go only when every one of its words goes.
  const dropsWholePhrase = ([start, end]: [number, number]): boolean => {
    for (let index = start; index < end; index += 1) if (!dropped.has(index)) return false;
    return true;
  };
  const noise = allowSpeechNoise ? speechNoise(source, dropped, phrases) : new Set<number>();
  const isExempt = (index: number): boolean => noise.has(index) || phrases.some(phrase => phrase[0] <= index && index < phrase[1] && dropsWholePhrase(phrase));
  return {
    missing: source.filter((_, index) => dropped.has(index) && !isExempt(index)).flatMap(unitWords),
    added: middle.added.flatMap(unitWords),
  };
}

// The word a source unit holds, or null for layout cues.
function unitText(unit: Unit | undefined): string | null {
  return unit?.kind === "word" || unit?.kind === "filler" ? unit.text : null;
}

// True when losing the word could flip meaning: a negation or a number.
function isProtected(text: string): boolean {
  return PROTECTED_WORDS.has(text) || isNumber(text);
}

// True for digits and spelled-out numbers, including Hindi and Marathi number words.
function isNumber(text: string): boolean {
  return /^[+-]?\.?\p{N}/u.test(text) || NUMBER_WORDS.has(text) || ORDINAL_NUMBERS.has(text) || isDevanagariNumberWord(text);
}

// The core sequence the stutter and correction rules read: words with their pause and sentence-boundary marks.
interface Core {
  words: (string | null)[];
  gone: boolean[];
  pause: boolean[];
  boundary: boolean[];
}

const AMBIGUOUS_CUES: ReadonlySet<string> = new Set(["mean", "actually", "rather", "wait"]);

// True when words[start..start+phrase) equals the phrase.
function startsWithPhrase(words: readonly (string | null)[], start: number, phrase: readonly (string | null)[]): boolean {
  return phrase.length > 0 && phrase.every((word, offset) => word !== null && words[start + offset] === word);
}

// Dropped source indices that are speech noise: cut-off words, stutters next to a kept copy, and corrected phrases.
function speechNoise(source: Unit[], dropped: ReadonlySet<number>, phrases: readonly [number, number][]): Set<number> {
  const noise = new Set<number>();
  for (const index of dropped) {
    const unit = source[index];
    const text = unitText(unit);
    if (!text || unit?.kind !== "word" || !unit.cut || isProtected(text)) continue;
    // A hyphen alone can be a dash or a suspended prefix ("Priya-- tomorrow", "pre- and post-paid"). A cut-off also
    // needs the speaker to restart: the next word starts with the fragment, a hesitation follows, or the word before repeats.
    const next = source[index + 1];
    const nextText = unitText(next);
    const restarts = nextText !== null && (
      (nextText.length > text.length && nextText.startsWith(text))
      || next?.kind === "filler"
      || (unitText(source[index - 1]) === nextText && text.length <= MAX_CUT_FRAGMENT)
    );
    if (restarts && nextText !== "and" && nextText !== "or") noise.add(index);
  }

  // The core sequence skips filler phrases and cut-off words, so "the uh the" and "there sh- there" read as stutters.
  const inPhrase = (index: number): boolean => phrases.some(([start, end]) => start <= index && index < end);
  const core = source.map((_, index) => index).filter(index => !noise.has(index) && !inPhrase(index));
  const info = coreOf(source, core, dropped);
  for (const [start, end] of droppedRuns(info.gone)) {
    const run = info.words.slice(start, end + 1);
    if (isStutter(run, info, start, end) || isCorrection(run, info, start, end)) {
      for (let position = start; position <= end; position += 1) noise.add(core[position] ?? -1);
    }
  }
  return noise;
}

// The core sequence for the source units at the given indices, with the dropped ones marked.
function coreOf(source: Unit[], core: readonly number[], dropped: ReadonlySet<number>): Core {
  return {
    words: core.map(index => unitText(source[index])),
    gone: core.map(index => dropped.has(index)),
    pause: core.map(index => { const unit = source[index]; return unit?.kind === "word" && unit.pause === true; }),
    boundary: core.map(index => { const unit = source[index]; return unit?.kind !== "word" || unit.boundary === true; }),
  };
}

// Each run of consecutive dropped positions, as [start, end] inclusive.
function droppedRuns(gone: readonly boolean[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = 0;
  while (start < gone.length) {
    if (!gone[start]) { start += 1; continue; }
    let end = start;
    while (end + 1 < gone.length && gone[end + 1]) end += 1;
    runs.push([start, end]);
    start = end + 1;
  }
  return runs;
}

// True when no sentence starts at any core position in (from, to].
function sameSentence(boundary: readonly boolean[], from: number, to: number): boolean {
  for (let position = from + 1; position <= to; position += 1) if (boundary[position]) return false;
  return true;
}

// True when the dropped run is one phrase said again, next to a kept copy of it in the same sentence
// ("no, no, no" keeping one "no"). Numbers never count: "1 1 2" is a value.
function isStutter(run: readonly (string | null)[], { words, gone, boundary }: Core, start: number, end: number): boolean {
  if (run.some(word => word !== null && isNumber(word))) return false;
  for (let size = 1; size <= MAX_STUTTER_PHRASE && size <= run.length; size += 1) {
    if (run.length % size !== 0) continue;
    const phrase = run.slice(0, size);
    let repeats = true;
    for (let offset = 0; offset < run.length && repeats; offset += size) repeats = startsWithPhrase(run, offset, phrase);
    if (!repeats) continue;
    const keptAfter = startsWithPhrase(words, end + 1, phrase) && gone.slice(end + 1, end + 1 + size).every(value => !value) && sameSentence(boundary, start, end + size);
    const keptBefore = start - size >= 0 && startsWithPhrase(words, start - size, phrase) && gone.slice(start - size, start).every(value => !value) && sameSentence(boundary, start - size, end);
    if (keptAfter || keptBefore) return true;
  }
  return false;
}

// True when the dropped run ends in correction cues, replaces at most four words of one sentence, and a kept
// replacement follows. The replaced words hold no negation or number. A lone cue may go only when it can't flip
// meaning ("sorry", not "no"). "I mean", "actually", "rather", and "wait" count only with a pause next to them,
// so "what I mean here" stays. A bare "no" counts only with a pause next to it ("Monday, no Tuesday") or another
// "no" beside it ("no no no"), so "there is no need" stays a negation.
function isCorrection(run: readonly (string | null)[], { words, gone, pause, boundary }: Core, start: number, end: number): boolean {
  if (end + 1 >= gone.length || gone[end + 1]) return false;
  let rest = run.length;
  const cues: string[] = [];
  const bareNoIsCue = (position: number): boolean =>
    pause[start + position] === true || pause[start + position - 1] === true || run[position - 1] === "no" || run[position + 1] === "no";
  for (let matched = true; matched && rest > 0;) {
    matched = false;
    for (const cue of CORRECTION_CUES) {
      const bareNo = cue.length === 1 && cue[0] === "no";
      if (cue.length <= rest && startsWithPhrase(run, rest - cue.length, cue) && (!bareNo || bareNoIsCue(rest - 1))) {
        cues.push(...cue);
        rest -= cue.length;
        matched = true;
        break;
      }
    }
  }
  if (cues.length === 0) return false;
  if (rest === 0) return cues.every(word => !isProtected(word));
  const replaced = run.slice(0, rest);
  // A number may be replaced by another number ("3.5, no, 4.5"). Negations and other numbers stay.
  // Only the number right before the cue may go: "Version 2 supports 3, no, 4" keeps the 2.
  const replacementIsNumber = isNumber(words[end + 1] ?? "");
  const correctable = (word: string, index: number): boolean => replacementIsNumber && isNumber(word) && index === replaced.length - 1;
  if (rest > MAX_REPLACED_WORDS || replaced.some((word, index) => word !== null && isProtected(word) && !correctable(word, index))) return false;
  if (!sameSentence(boundary, start, start + rest - 1)) return false;
  const firstCue = start + rest;
  // A cue that opens a new sentence does not correct a number in the sentence before it ("3. Sorry, 4").
  if (boundary[firstCue] && !boundary[end + 1] && replaced.some(word => word !== null && isNumber(word))) return false;
  // A replacement in the next sentence needs the cue to stand as its own sentence ("Priyanka, run... Sorry. Priya").
  // Otherwise "He said no. No one agreed." would read as a correction.
  if (boundary[end + 1] && !boundary[firstCue]) return false;
  const ambiguous = run.slice(rest).some(word => word !== null && AMBIGUOUS_CUES.has(word));
  return !ambiguous || pause[firstCue - 1] === true || pause[end] === true;
}

export interface DiffOptions {
  /** Allow dropping stutters, cut-off words, and corrected phrases. Off when cleanup is off. */
  speechNoise?: boolean;
}

// Words the formatter dropped, reordered, or added. Listed fillers may be dropped but not added.
export function diffContentWords(rawText: string, candidate: string, fillers: readonly string[] = [], options: DiffOptions = {}): ContentWordDiff {
  const input = inputUnits(rawText, fillers);
  return alignUnits(input.units, input.phrases, splitJoinedWords(input.units, outputUnits(candidate), candidate), options.speechNoise ?? true);
}

// Splits an output word back into two adjacent input words it joins, so "open router" may come back as "OpenRouter".
// Only a camel-case name of letters counts: "now here" as "nowhere" or "2 5" as "25" changes meaning.
function splitJoinedWords(source: Unit[], output: Unit[], candidate: string): Unit[] {
  const camelCase = new Set((candidate.match(CAMEL_CASE_RE) ?? []).map(word => word.toLowerCase()));
  const pairs = new Map<string, [string, string]>();
  const sourceWords = new Set<string>();
  source.forEach((unit, index) => {
    const text = unitText(unit);
    if (text) sourceWords.add(text);
    const next = source[index + 1];
    if (unit.kind === "word" && next?.kind === "word" && camelCase.has(unit.text + next.text)) pairs.set(unit.text + next.text, [unit.text, next.text]);
  });
  return output.flatMap((unit): Unit[] => {
    const pair = unit.kind === "word" && !sourceWords.has(unit.text) ? pairs.get(unit.text) : undefined;
    return pair ? pair.map((text): Unit => ({ kind: "word", text })) : [unit];
  });
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

export interface GuardVerdict {
  /** Why the reply is rejected, or null when it may be used. */
  rejection: string | null;
  /** Words the reply dropped that no rule explains. */
  dropped: string[];
  /** Words the reply added that the speaker never said. */
  added: string[];
}

// Decides whether a formatter reply may replace the transcript. Cleanup off: every word must stay.
// Cleanup on: rejects only a large drop, added words, or a changed number or negation.
export function judgeFormatterReply(rawText: string, candidate: string, fillers: readonly string[] = [], options: DiffOptions = {}): GuardVerdict {
  const verdict = judgeAgainst(rawText, candidate, fillers, options);
  if (verdict.rejection === null || options.speechNoise === false) return verdict;
  // A reply may also drop a sentence the speaker withdrew with "scratch that". It is judged against the input
  // without that sentence, since the word alignment can match a repeated opening ("I'll be … I'll be") to it.
  const scratched = dropScratchedSentences(rawText);
  if (scratched === rawText) return verdict;
  const scratchedVerdict = judgeAgainst(scratched, candidate, fillers, options);
  return scratchedVerdict.rejection === null ? scratchedVerdict : verdict;
}

// Judges a reply against one version of the input.
function judgeAgainst(rawText: string, candidate: string, fillers: readonly string[], options: DiffOptions): GuardVerdict {
  const strict = options.speechNoise === false;
  const diff = diffContentWords(rawText, candidate, fillers, options);
  if (strict) {
    const rejection = diff.rejection ?? (diff.missing.length > 0 || diff.added.length > 0 ? CHANGED_WORDS_REASON : null);
    return { rejection, dropped: diff.missing, added: diff.added };
  }
  const input = inputUnits(rawText, fillers);
  const sourceWords = input.units.flatMap(unit => (unit.kind === "filler" ? [] : unitWords(unit)));
  // Too long to align: compare the words as counts instead, excusing only corrections the reply dropped.
  const output = outputWordsOf(candidate);
  const wordUnits = input.units.flatMap((unit, index) => (unit.kind === "filler" ? [] : unitWords(unit).map(() => index)));
  const countedWords = diff.rejection ? countedSourceWords(input.units, sourceWords, wordUnits, output) : sourceWords;
  const { missing, added } = diff.rejection ? { missing: bagDifference(countedWords, output), added: bagDifference(output, countedWords) } : diff;
  // A word that only moved is in both lists. Ordinals count as their numbers, so "second" may come back as "2".
  const dropped = bagDifference(missing, added);
  const newWords = bagDifference(added, missing);
  let rejection: string | null = null;
  if ([...dropped, ...newWords].some(isProtected)) rejection = CHANGED_MEANING_REASON;
  else if (newWords.length > MAX_NEW_WORDS) rejection = ADDED_WORDS_REASON;
  else if (dropped.length > sourceWords.length * MAX_DROPPED_SHARE) rejection = DROPPED_WORDS_REASON;
  return { rejection, dropped, added: newWords };
}

// Every word of a formatter reply, list numbers included.
function outputWordsOf(candidate: string): string[] {
  return outputUnits(candidate).flatMap(unitWords);
}

// Positions of the source words the output drops. Words that occur once on each side pin the order, so a repeated
// word ("3" kept later in the sentence) pairs with its own place. Only the gaps between pins use bag matching.
function droppedPositions(words: readonly string[], output: readonly string[]): number[] {
  const sourceCounts = countWords(words);
  const outputCounts = countWords(output);
  const outputIndex = new Map(output.map((word, position) => [word, position]));
  const pins: [number, number][] = [];
  let outputFrom = 0;
  words.forEach((word, position) => {
    const outputPosition = outputIndex.get(word) ?? -1;
    if (sourceCounts.get(word) !== 1 || outputCounts.get(word) !== 1 || outputPosition < outputFrom) return;
    pins.push([position, outputPosition]);
    outputFrom = outputPosition + 1;
  });
  pins.push([words.length, output.length]);
  const dropped: number[] = [];
  let sourceFrom = 0;
  let outputStart = 0;
  for (const [sourceEnd, outputEnd] of pins) {
    dropped.push(...gapDropped(words.slice(sourceFrom, sourceEnd), output.slice(outputStart, outputEnd)).map(position => position + sourceFrom));
    sourceFrom = sourceEnd + 1;
    outputStart = outputEnd + 1;
  }
  return dropped;
}

// Positions of a gap's source words that the gap's output drops. Aligns in order, or walks in order when the gap is too big.
function gapDropped(words: readonly string[], output: readonly string[]): number[] {
  const asUnits = (list: readonly string[]): Unit[] => list.map((text): Unit => ({ kind: "word", text }));
  return alignSections(asUnits(words), asUnits(output))?.dropped ?? inOrderDropped(words, output);
}

// Positions of source words left unmatched by one in-order walk, in linear time. A reply word the source lacks is skipped
// when the next reply word matches, so one inserted word does not drop the rest of the gap.
function inOrderDropped(words: readonly string[], output: readonly string[]): number[] {
  const dropped: number[] = [];
  let reply = 0;
  words.forEach((word, position) => {
    if (matchesAt(word, output, reply)) reply += 1;
    else if (matchesAt(word, output, reply + 1)) reply += 2;
    else dropped.push(position);
  });
  return dropped;
}

// True when the reply has a word at index that matches the source word.
function matchesAt(word: string, output: readonly string[], index: number): boolean {
  const next = output[index];
  return next !== undefined && sameBagWord(word, next);
}

// How many times each word occurs in a list.
function countWords(words: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}

// Long transcripts: the source words left after excusing the numbers and cues of each dropped run that isCorrection accepts.
// wordUnits maps each word to its source unit index. Only a whole word unit can be excused, never a list or line cue.
function countedSourceWords(units: Unit[], words: readonly string[], wordUnits: readonly number[], output: readonly string[]): string[] {
  const droppedUnits = new Set(droppedPositions(words, output).map(position => wordUnits[position] ?? -1));
  const core = units.flatMap((unit, index) => (unit.kind === "filler" ? [] : [index]));
  const info = coreOf(units, core, droppedUnits);
  const excused = new Set<number>();
  for (const [start, end] of droppedRuns(info.gone)) {
    if (!isCorrection(info.words.slice(start, end + 1), info, start, end)) continue;
    for (let position = start; position <= end; position += 1) {
      const index = core[position] ?? -1;
      const unit = units[index];
      if (unit?.kind === "word" && (isNumber(unit.text) || CORRECTION_CUE_WORDS.has(unit.text))) excused.add(index);
    }
  }
  return words.filter((_, position) => !excused.has(wordUnits[position] ?? -1));
}

// The number an ordinal names ("second", "2nd" → "2"), or the word itself.
function ordinalKey(word: string): string {
  return ORDINAL_NUMBERS.get(word) ?? /^(\d+)(?:st|nd|rd|th)$/.exec(word)?.[1] ?? word;
}

// True when two words count as the same: equal, the same ordinal, or a Devanagari word and its Roman spelling.
function sameBagWord(left: string, right: string): boolean {
  if (ordinalKey(left) === ordinalKey(right)) return true;
  return (isDevanagariWord(left) && soundsAlike(left, right)) || (isDevanagariWord(right) && soundsAlike(right, left));
}

// Positions of a that are left after removing one matching copy of each word of b.
function unmatchedPositions(a: readonly string[], b: readonly string[]): number[] {
  const remaining = [...b];
  return a.flatMap((word, position) => {
    const index = remaining.findIndex(other => sameBagWord(word, other));
    if (index < 0) return [position];
    remaining.splice(index, 1);
    return [];
  });
}

// Words of a that are left after removing one matching copy of each word of b.
function bagDifference(a: readonly string[], b: readonly string[]): string[] {
  const left = new Set(unmatchedPositions(a, b));
  return a.filter((_, position) => left.has(position));
}
