import { describe, expect, it } from "vitest";
import { detectDictionarySuggestions } from "@shared/dictionarySuggestions";

describe("detectDictionarySuggestions", () => {
  it("returns phrase-to-word correction pairs when a correction collapses tokens", () => {
    expect(detectDictionarySuggestions("please open get hub docs", "please open GitHub docs")).toEqual([
      { spoken: "get hub", written: "GitHub" }
    ]);
  });

  it("returns one-to-one word corrections when tokens stay aligned", () => {
    expect(detectDictionarySuggestions("teh recieve update", "the receive update")).toEqual([
      { spoken: "teh", written: "the" },
      { spoken: "recieve", written: "receive" }
    ]);
  });

  it("ignores edits when the remaining text no longer lines up", () => {
    expect(detectDictionarySuggestions("open get hub", "open the GitHub page now")).toEqual([]);
  });
});
