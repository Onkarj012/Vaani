function clean(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, "");
}

// Compact Double Metaphone implementation for dictionary-sized words and phrases.
export function doubleMetaphone(value: string): [string, string] {
  const word = clean(value);
  if (!word) return ["", ""];
  const primary: string[] = [];
  const alternate: string[] = [];
  const emit = (one: string, two = one) => {
    if (primary.join("").length < 8) primary.push(one);
    if (alternate.join("").length < 8) alternate.push(two);
  };
  let i = 0;
  while (i < word.length && primary.join("").length < 8) {
    const c = word[i]!;
    const next = word[i + 1] ?? "";
    const previous = word[i - 1] ?? "";
    if (i === 0 && (word.startsWith("KN") || word.startsWith("GN") || word.startsWith("PN") || word.startsWith("AE") || word.startsWith("WR"))) {
      i += 1;
      continue;
    }
    if (c === "C") {
      if (word.startsWith("CH", i)) { emit("X", "K"); i += 2; continue; }
      if (word.startsWith("CIA", i)) { emit("X"); i += 3; continue; }
      emit(/[EIY]/.test(next) ? "S" : "K");
    } else if (c === "G") {
      if (word.startsWith("GH", i)) { emit(i > 0 ? "K" : ""); i += 2; continue; }
      if (/[EIY]/.test(next)) emit("J", "K"); else emit("K");
    } else if (c === "J") emit("J", "A");
    else if (c === "P") { emit(next === "H" ? "F" : "P"); if (next === "H") i += 1; }
    else if (c === "T") { emit(word.startsWith("TH", i) ? "0" : "T", word.startsWith("TH", i) ? "T" : "T"); if (next === "H") i += 1; }
    else if (c === "D") emit(next === "G" && /[EIY]/.test(word[i + 2] ?? "") ? "J" : "T");
    else if (c === "S") { emit(word.startsWith("SH", i) ? "X" : "S"); if (next === "H") i += 1; }
    else if (c === "Z") emit("S", "TS");
    else if (c === "X") emit("KS");
    else if (c === "Q") emit("K");
    else if (c === "V") emit("F");
    else if (c === "W" || c === "Y") { if (/[AEIOU]/.test(next)) emit(c); }
    else if (c === "B" || c === "F" || c === "K" || c === "L" || c === "M" || c === "N" || c === "R") emit(c);
    else if (c === "H") { if (/[AEIOU]/.test(next) && !/[AEIOU]/.test(previous)) emit("H"); }
    else if (/[AEIOU]/.test(c)) { if (i === 0) emit("A"); }
    i += 1;
  }
  return [primary.join(""), alternate.join("") || primary.join("")];
}

export function phoneticKeysEqual(left: string, right: string): boolean {
  const a = doubleMetaphone(left);
  const b = doubleMetaphone(right);
  return a.some(key => key.length > 0 && b.includes(key));
}
