import { describe, expect, it } from "vitest";
import { detectDictionarySuggestions } from "@shared/dictionarySuggestions";

describe("detectDictionarySuggestions", () => {
  it("returns phrase-to-word correction for a single close mishear", () => {
    expect(detectDictionarySuggestions("please open get hub docs", "please open GitHub docs")).toEqual([
      { spoken: "get hub", written: "GitHub" }
    ]);
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

  it("prompts on single close substitution", () => {
    const result = detectDictionarySuggestions("groq is fast", "grok is fast");
    expect(result).toHaveLength(1);
    expect(result[0]?.spoken).toBe("groq");
    expect(result[0]?.written).toBe("grok");
  });

  it("no prompt when edit distance too large (unrelated rewrite)", () => {
    expect(detectDictionarySuggestions("hello everyone", "goodbye world")).toEqual([]);
  });
});
