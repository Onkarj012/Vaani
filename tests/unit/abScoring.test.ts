import { describe, expect, it } from "vitest";
import { firstWordMissed, lastWordMissed, missingTerms, normalizeWords, scoreClip, wordErrorRate } from "@scripts/ab/scoring";

describe("normalizeWords", () => {
  it("lowercases and drops punctuation", () => {
    expect(normalizeWords("Hello, World! It's fine.")).toEqual(["hello", "world", "its", "fine"]);
  });

  it("drops straight, curly, and omitted apostrophes", () => {
    expect(normalizeWords("don't")).toEqual(["dont"]);
    expect(normalizeWords("don’t")).toEqual(["dont"]);
    expect(normalizeWords("dont")).toEqual(["dont"]);
  });

  it("keeps Devanagari vowel signs and digits inside words", () => {
    expect(normalizeWords("मेरा नाम है। 42 बजे")).toEqual(["मेरा", "नाम", "है", "42", "बजे"]);
  });

  it("compares precomposed and decomposed nukta letters as equal", () => {
    expect(normalizeWords("क़")).toEqual(normalizeWords("क़"));
    expect(wordErrorRate("क़ा", "क़ा")).toBe(0);
  });
});

describe("wordErrorRate", () => {
  it("is 0 for an exact match", () => {
    expect(wordErrorRate("send the report today", "send the report today")).toBe(0);
  });

  it("counts a substitution as one edit", () => {
    expect(wordErrorRate("the cat sat", "the dog sat")).toBeCloseTo(1 / 3);
  });

  it("counts an insertion as one edit", () => {
    expect(wordErrorRate("hello world", "hello big world")).toBe(0.5);
  });

  it("counts a deletion as one edit", () => {
    expect(wordErrorRate("one two three four", "one three four")).toBe(0.25);
  });

  it("is 1 for an empty hypothesis", () => {
    expect(wordErrorRate("one two three", "")).toBe(1);
  });

  it("ignores case and punctuation", () => {
    expect(wordErrorRate("Hello, World!", "hello world")).toBe(0);
  });

  it("treats Devanagari with a different vowel sign as a word error", () => {
    expect(wordErrorRate("मेरा नाम है", "मेरा नाम हैं")).toBeCloseTo(1 / 3);
  });

  it("matches Hinglish with different punctuation", () => {
    expect(wordErrorRate("Mujhe kal meeting hai.", "mujhe kal meeting hai")).toBe(0);
  });

  it("scores a contraction the same whether or not the apostrophe is present", () => {
    expect(wordErrorRate("don't stop", "dont stop")).toBe(0);
    expect(wordErrorRate("don’t stop", "don't stop")).toBe(0);
  });
});

describe("first and last word misses", () => {
  it("flags a dropped first word", () => {
    expect(firstWordMissed("book the room", "the room")).toBe(true);
    expect(lastWordMissed("book the room", "the room")).toBe(false);
  });

  it("flags a dropped last word", () => {
    expect(lastWordMissed("book the room", "book the")).toBe(true);
    expect(firstWordMissed("book the room", "book the")).toBe(false);
  });

  it("flags both on an empty hypothesis", () => {
    expect(firstWordMissed("book the room", "")).toBe(true);
    expect(lastWordMissed("book the room", "")).toBe(true);
  });

  it("does not flag an empty reference", () => {
    expect(firstWordMissed("", "anything")).toBe(false);
    expect(lastWordMissed("", "")).toBe(false);
  });

  it("does not flag an extra word before the first word", () => {
    expect(firstWordMissed("book the room", "please book the room")).toBe(false);
    expect(lastWordMissed("book the room", "please book the room")).toBe(false);
  });

  it("does not flag an extra word after the last word", () => {
    expect(firstWordMissed("book the room", "book the room please")).toBe(false);
    expect(lastWordMissed("book the room", "book the room please")).toBe(false);
  });

  it("flags a substituted first word", () => {
    expect(firstWordMissed("book the room", "cook the room")).toBe(true);
    expect(lastWordMissed("book the room", "cook the room")).toBe(false);
  });

  it("flags a substituted last word", () => {
    expect(firstWordMissed("book the room", "book the zoom")).toBe(false);
    expect(lastWordMissed("book the room", "book the zoom")).toBe(true);
  });

  it("flags a deleted first word even when a word was inserted elsewhere", () => {
    expect(firstWordMissed("book the room", "the room please")).toBe(true);
  });
});

describe("missingTerms", () => {
  it("returns the reference terms that are not in the transcript", () => {
    const terms = ["Ananya", "Kubernetes", "Vaani Dictation"];
    expect(missingTerms(terms, "ananya uses kubernets for vaani dictation")).toEqual(["Kubernetes"]);
  });

  it("requires multi-word terms to appear as a run", () => {
    expect(missingTerms(["Vaani Dictation"], "vaani is a dictation tool")).toEqual(["Vaani Dictation"]);
  });

  it("finds a term regardless of case and punctuation", () => {
    expect(missingTerms(["Groq"], "We use groq, yes.")).toEqual([]);
  });
});

describe("scoreClip", () => {
  it("combines the clip metrics", () => {
    expect(scoreClip("call Ananya today", "call Anaya today", ["Ananya"])).toEqual({
      wer: 1 / 3,
      firstWordMissed: false,
      lastWordMissed: false,
      termCount: 1,
      missedTerms: ["Ananya"],
    });
  });
});
