// Sound check for a Devanagari word the formatter rewrote in Roman letters ("कैंसल" → "cancel").
// Both words become a rough consonant shape; vowels, aspiration, and doubled letters drop out.

const DEVANAGARI_WORD_RE = /^[ऀ-ॿ]+$/u;
const LATIN_WORD_RE = /^[a-z]+$/u;
const NUKTA = "़";
const NASALS = new Set(["ँ", "ं"]);
const VISARGA = "ः";
const VOCALIC_R = new Set(["ऋ", "ृ"]);

// Consonant classes. "C" is the ch sound, kept apart from the k/s sounds of English c.
const CONSONANTS: Readonly<Record<string, string>> = {
  "क": "k", "ख": "k", "ग": "g", "घ": "g", "ङ": "n",
  "च": "C", "छ": "C", "ज": "j", "झ": "j", "ञ": "n",
  "ट": "t", "ठ": "t", "ड": "d", "ढ": "d", "ण": "n",
  "त": "t", "थ": "t", "द": "d", "ध": "d", "न": "n",
  "प": "p", "फ": "f", "ब": "b", "भ": "b", "म": "m",
  "य": "y", "र": "r", "ल": "l", "ळ": "l", "व": "v",
  "श": "s", "ष": "s", "स": "s", "ह": "h",
};

// Letters a nukta turns into another sound, with the plain sound still allowed (ज़ is z, often written j).
const NUKTA_SOUNDS: Readonly<Record<string, string[]>> = {
  "ज": ["s", "j"], "ड": ["r", "d"], "ढ": ["r", "d"], "फ": ["f"], "क": ["k"], "ख": ["k"], "ग": ["g"],
};

const LATIN_DIGRAPHS: readonly [string, string][] = [
  ["ch", "C"], ["sh", "s"], ["ph", "f"], ["kh", "k"], ["gh", "g"], ["th", "t"], ["dh", "d"], ["bh", "b"], ["jh", "j"], ["ck", "k"],
];

const MAX_SHAPES = 32;
const SHAPE_CACHE_LIMIT = 5_000;
const shapeCache = new Map<string, string[]>();

// True when the word is all Devanagari letters and marks.
export function isDevanagariWord(word: string): boolean {
  return DEVANAGARI_WORD_RE.test(word);
}

// Drops repeated letters and the soft h, y, v sounds after the first letter, which Roman spellings add or skip freely.
function settleShape(shape: string): string {
  const collapsed = shape.replace(/(.)\1+/g, "$1");
  return (collapsed[0] ?? "") + collapsed.slice(1).replace(/[hyv]/g, "");
}

// Every consonant shape a Devanagari word can take. Nasal marks and nukta letters allow more than one.
function devanagariShapes(word: string): string[] {
  const cached = shapeCache.get(word);
  if (cached) return cached;
  let shapes = [""];
  const letters = [...word.normalize("NFC")];
  const extend = (options: string[]): void => {
    shapes = shapes.flatMap(shape => options.map(option => shape + option)).slice(0, MAX_SHAPES);
  };
  letters.forEach((letter, index) => {
    if (letter === NUKTA) return;
    const consonant = CONSONANTS[letter];
    if (consonant) extend(letters[index + 1] === NUKTA ? NUKTA_SOUNDS[letter] ?? [consonant] : [consonant]);
    else if (NASALS.has(letter)) extend(["n", ""]);
    else if (letter === VISARGA) extend(["h"]);
    else if (VOCALIC_R.has(letter)) extend(["r"]);
  });
  const settled = [...new Set(shapes.map(settleShape))];
  if (shapeCache.size >= SHAPE_CACHE_LIMIT) shapeCache.clear();
  shapeCache.set(word, settled);
  return settled;
}

// The consonant shape of a lowercase Roman word.
function latinShape(word: string): string {
  let text = word;
  for (const [digraph, sound] of LATIN_DIGRAPHS) text = text.replaceAll(digraph, sound);
  text = text
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/w/g, "v")
    .replace(/z/g, "s")
    .replace(/[aeiou]/g, "");
  return settleShape(text);
}

// Edit distance of at most one between two short strings.
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// True when a lowercase Roman word plausibly spells the same spoken word as a Devanagari one.
// Longer shapes may differ by one sound, since Roman Hindi spelling varies.
export function soundsAlike(devanagariWord: string, latinWord: string): boolean {
  if (!isDevanagariWord(devanagariWord) || !LATIN_WORD_RE.test(latinWord)) return false;
  const roman = latinShape(latinWord);
  return devanagariShapes(devanagariWord).some(shape =>
    shape === roman || (Math.min(shape.length, roman.length) >= 3 && withinOneEdit(shape, roman)));
}
