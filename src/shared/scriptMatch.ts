// Sound check for a Devanagari word the formatter rewrote in Roman letters ("कैंसल" → "cancel").
// Both words become consonant shapes; vowels, aspiration, and doubled letters drop out. The shapes must match exactly.
// Only known Roman spelling variants add extra shapes: a nasal mark, a nukta letter, a final h ("toh"), an h after a
// consonant ("achha"), a y after a vowel ("gayi"), z written for j ("cheez"), a soft g ("message"), "cch" for ch ("acchi"),
// and m for a nasal before p, b, or m ("sambhalo"). Shapes can't tell apart words that share consonants, so negations
// and numbers take fixed spellings.

const DEVANAGARI_WORD_RE = /^[\u0900-\u097F]+$/u;
const LATIN_WORD_RE = /^[a-z]+$/u;
const NUKTA = "\u093C";
const NASALS = new Set(["\u0901", "\u0902"]);
const VISARGA = "\u0903";
const VOCALIC_R = new Set(["\u090B", "\u0943"]);
const VOWELS = new Set(["a", "e", "i", "o", "u"]);

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

// Negations and number words change meaning when one sound changes ("साठ" sixty, "सात" seven), so they take only
// these Roman spellings instead of the sound check.
const FIXED_SPELLINGS: ReadonlyMap<string, ReadonlySet<string>> = new Map(Object.entries({
  "न": "na naa", "ना": "na naa", "नहीं": "nahi nahin nahee nai nhi", "नही": "nahi nahin nahee nai nhi", "मत": "mat",
  "नको": "nako", "नाही": "nahi nai", "शून्य": "shunya shoonya",
  "एक": "ek", "दो": "do", "दोन": "don", "तीन": "teen tin", "चार": "char chaar", "पांच": "paanch panch", "पाँच": "paanch panch",
  "पाच": "paach pach", "छह": "chhah chah cheh chhe che chhai", "छः": "chhah chah cheh chhe che", "सहा": "saha", "सात": "saat sat",
  "आठ": "aath ath", "नौ": "nau nao", "नऊ": "nau nao", "दस": "das", "दहा": "daha", "ग्यारह": "gyarah gyara", "बारह": "barah bara baarah",
  "तेरह": "terah tera", "चौदह": "chaudah chauda", "पंद्रह": "pandrah pandra", "पन्द्रह": "pandrah pandra", "सोलह": "solah sola",
  "सत्रह": "satrah satra", "अठारह": "atharah athara", "उन्नीस": "unnis unees unnees", "बीस": "bees bis", "तीस": "tees tis",
  "चालीस": "chalis chaalis", "पचास": "pachas pachaas", "साठ": "saath sath", "सत्तर": "sattar", "अस्सी": "assi", "नब्बे": "nabbe",
  "सौ": "sau so", "हज़ार": "hazaar hazar hajar", "हजार": "hazaar hazar hajar", "लाख": "lakh laakh", "करोड़": "crore karod karor",
  "करोड": "crore karod karor",
}).map(([word, spellings]) => [word.normalize("NFC"), new Set(spellings.split(" "))]));

const LABIALS = new Set(["प", "फ", "ब", "भ", "म"]);

const LATIN_DIGRAPHS: Readonly<Record<string, string>> = {
  ch: "C", sh: "s", ph: "f", kh: "k", gh: "g", th: "t", dh: "d", bh: "b", jh: "j", ck: "k",
};

const MAX_SHAPES = 32;
const SHAPE_CACHE_LIMIT = 5_000;
const shapeCache = new Map<string, string[]>();

// True when the word is all Devanagari letters and marks.
export function isDevanagariWord(word: string): boolean {
  return DEVANAGARI_WORD_RE.test(word);
}

// Drops repeated letters, which Roman spellings double or not freely.
function settleShape(shape: string): string {
  return shape.replace(/(.)\1+/g, "$1");
}

// Appends each option to each shape so far, keeping the list bounded.
function extendShapes(shapes: string[], options: readonly string[]): string[] {
  return shapes.flatMap(shape => options.map(option => shape + option)).slice(0, MAX_SHAPES);
}

// Caches a word's shapes, clearing the cache when it grows large.
function remember(word: string, shapes: string[]): string[] {
  if (shapeCache.size >= SHAPE_CACHE_LIMIT) shapeCache.clear();
  shapeCache.set(word, shapes);
  return shapes;
}

// Every consonant shape a Devanagari word can take.
function devanagariShapes(word: string): string[] {
  const key = `d:${word}`;
  const cached = shapeCache.get(key);
  if (cached) return cached;
  let shapes = [""];
  const letters = [...word.normalize("NFC")];
  letters.forEach((letter, index) => {
    if (letter === NUKTA) return;
    const consonant = CONSONANTS[letter];
    if (consonant) shapes = extendShapes(shapes, letters[index + 1] === NUKTA ? NUKTA_SOUNDS[letter] ?? [consonant] : [consonant]);
    else if (NASALS.has(letter)) shapes = extendShapes(shapes, LABIALS.has(letters[index + 1] ?? "") ? ["m", "n", ""] : ["n", ""]);
    else if (letter === VISARGA) shapes = extendShapes(shapes, ["h"]);
    else if (VOCALIC_R.has(letter)) shapes = extendShapes(shapes, ["r"]);
  });
  return remember(key, [...new Set(shapes.map(settleShape))]);
}

// Every consonant shape a lowercase Roman word can take.
function latinShapes(word: string): string[] {
  const key = `l:${word}`;
  const cached = shapeCache.get(key);
  if (cached) return cached;
  let shapes = [""];
  for (let index = 0; index < word.length; index += 1) {
    const letter = word[index] ?? "";
    const next = word[index + 1] ?? "";
    const digraph = LATIN_DIGRAPHS[letter + next];
    if (digraph) { shapes = extendShapes(shapes, [digraph]); index += 1; continue; }
    if (VOWELS.has(letter)) continue;
    if (letter === "c" && next === "c" && word[index + 2] === "h") continue;
    const previous = word[index - 1] ?? "";
    const afterVowel = VOWELS.has(previous);
    let options: string[];
    if (letter === "c") options = [/[eiy]/.test(next) ? "s" : "k"];
    else if (letter === "g") options = /[ei]/.test(next) ? ["g", "j"] : ["g"];
    else if (letter === "q") options = ["k"];
    else if (letter === "x") options = ["ks"];
    else if (letter === "w") options = ["v"];
    else if (letter === "z") options = ["s", "j"];
    else if (letter === "y") options = index > 0 && afterVowel ? ["y", ""] : ["y"];
    else if (letter === "h") options = (index === word.length - 1 && afterVowel) || (index > 0 && !afterVowel) ? ["h", ""] : ["h"];
    else options = [letter];
    shapes = extendShapes(shapes, options);
  }
  return remember(key, [...new Set(shapes.map(settleShape))]);
}

// True when a lowercase Roman word plausibly spells the same spoken word as a Devanagari one.
export function soundsAlike(devanagariWord: string, latinWord: string): boolean {
  if (!isDevanagariWord(devanagariWord) || !LATIN_WORD_RE.test(latinWord)) return false;
  const fixed = FIXED_SPELLINGS.get(devanagariWord.normalize("NFC"));
  if (fixed) return fixed.has(latinWord);
  const roman = new Set(latinShapes(latinWord));
  return devanagariShapes(devanagariWord).some(shape => roman.has(shape));
}
