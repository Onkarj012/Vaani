import { describe, expect, it } from "vitest";
import { detectDictionarySuggestions } from "@shared/dictionarySuggestions";

describe("detectDictionarySuggestions", () => {
  it("returns phrase-to-word correction for a single close mishear", () => {
    expect(detectDictionarySuggestions("please open get hub docs", "please open GitHub docs")).toEqual([
      { spoken: "get hub", written: "GitHub" }
    ]);

    expect(detectDictionarySuggestions("please open git hub docs", "please open GitHub docs")).toEqual([
      { spoken: "git hub", written: "GitHub" }
    ]);
  });

  it("rejects exact-threshold digit-poisoned corrections", () => {
    expect(detectDictionarySuggestions("It", "1 It")).toEqual([]);
  });

  it("rejects suggestions that add a digit absent from the spoken side", () => {
    expect(detectDictionarySuggestions("one", "on3")).toEqual([]);
  });

  it("does not auto-learn number formatting changes", () => {
    expect(detectDictionarySuggestions("four", "4")).toEqual([]);
  });

  it("no prompt for multiple simultaneous corrections (multi-word rewrite)", () => {
    // Two changed tokens → not a single mishear → no prompt.
    expect(detectDictionarySuggestions("teh recieve update", "the receive update")).toEqual([]);
  });

  it("ignores edits when the remaining text no longer lines up", () => {
    expect(detectDictionarySuggestions("open get hub", "open the GitHub page now")).toEqual([]);
  });

  it("no prompt on pure word deletion", () => {
    expect(detectDictionarySuggestions("hello world there", "hello there")).toEqual([]);
  });

  it("no prompt on punctuation-only change", () => {
    expect(detectDictionarySuggestions("hello world", "hello world.")).toEqual([]);
  });

  it("detects a single proper-noun substitution", () => {
    expect(detectDictionarySuggestions("the final word is Bani", "the final word is Vaani")).toEqual([
      { spoken: "Bani", written: "Vaani" }
    ]);
  });

  it("detects mid-sentence case corrections for dictionary-worthy terms", () => {
    expect(detectDictionarySuggestions("the final word is google", "the final word is Google")).toEqual([
      { spoken: "google", written: "Google" }
    ]);
  });

  it("does not auto-learn sentence-start capitalization by itself", () => {
    expect(detectDictionarySuggestions("google is fast", "Google is fast")).toEqual([]);
  });

  it("does not auto-learn ordinary lowercase substitutions", () => {
    expect(detectDictionarySuggestions("this food is hot", "this good is hot")).toEqual([]);
  });

  it("detects mid-sentence product-name substitutions", () => {
    const result = detectDictionarySuggestions("ask groq today", "ask Grok today");
    expect(result).toHaveLength(1);
    expect(result[0]?.spoken).toBe("groq");
    expect(result[0]?.written).toBe("Grok");
  });

  it("detects camel-case product name corrections", () => {
    expect(detectDictionarySuggestions(
      "I'm making a LaTeX editor called WriteX.",
      "I'm making a LaTeX editor called WriteTex."
    )).toEqual([
      { spoken: "WriteX", written: "WriteTex" }
    ]);
  });

  it("no prompt when edit distance too large (unrelated rewrite)", () => {
    expect(detectDictionarySuggestions("hello everyone", "goodbye world")).toEqual([]);
  });

  it("rejects typed-continuation artifacts (word + punctuation-joined keystrokes)", () => {
    // User kept typing after the inserted dictation: "GitHub." + "a" merges
    // into one token and must never become the rule GitHub → GitHub.a.
    expect(detectDictionarySuggestions("push it to GitHub.", "push it to GitHub.a")).toEqual([]);
    expect(detectDictionarySuggestions("see the CLAUDE file", "see the CLAUDE.m file")).toEqual([]);
  });

  it("rejects common-word spoken triggers", () => {
    // "on" → "Onk" is phonetically close and Onk looks name-like, but a rule
    // triggered by "on" would rewrite nearly every future dictation.
    expect(detectDictionarySuggestions("meet on Monday", "meet Onk Monday")).toEqual([]);
    expect(detectDictionarySuggestions("take a break", "take Aan break")).toEqual([]);
  });

  it("rejects spoken triggers shorter than three characters", () => {
    expect(detectDictionarySuggestions("use js here", "use Jas here")).toEqual([]);
  });

  it("still learns genuine proper-noun corrections after gate hardening", () => {
    expect(detectDictionarySuggestions("ask Bani about it", "ask Vaani about it")).toEqual([
      { spoken: "Bani", written: "Vaani" }
    ]);
  });
});
