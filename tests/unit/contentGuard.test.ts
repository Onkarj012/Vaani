import { describe, expect, it } from "vitest";
import { preservesContentWords } from "../../src/shared/contentGuard";

describe("preservesContentWords", () => {
  it("accepts faithful punctuation/capitalization changes", () => {
    expect(preservesContentWords("hello world", "Hello, world.")).toBe(true);
  });

  it("rejects dropped sentence (condensed output)", () => {
    expect(preservesContentWords(
      "the quick brown fox jumped over the lazy dog",
      "The quick brown fox."
    )).toBe(false);
  });

  it("accepts list reorder — order-independent check", () => {
    expect(preservesContentWords(
      "first item do this second item do that",
      "do that\ndo this"
    )).toBe(true);
  });

  it("preserves ordinals used as ordinary content words", () => {
    expect(preservesContentWords(
      "my first goal is X my second goal is Y",
      "My goal is X. My goal is Y."
    )).toBe(false);
  });

  it("accepts number-word to digit conversion", () => {
    expect(preservesContentWords("I have twenty items", "I have 20 items.")).toBe(true);
  });

  it("accepts filler removal (um, uh, like)", () => {
    expect(preservesContentWords("um hello uh world", "Hello, world.")).toBe(true);
  });

  it("returns true for empty raw text", () => {
    expect(preservesContentWords("", "anything")).toBe(true);
  });

  it("rejects when a content word disappears", () => {
    expect(preservesContentWords("contact Anthropic support", "contact support")).toBe(false);
  });

  it("ignores spoken cue words", () => {
    expect(preservesContentWords("bullet point write the report", "Write the report.")).toBe(true);
  });
});
