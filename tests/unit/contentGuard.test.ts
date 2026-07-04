import { describe, expect, it } from "vitest";
import { addedContentWords, missingContentWords, preservesContentWords } from "../../src/shared/contentGuard";

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

  it("accepts list reorder with visible list markers", () => {
    expect(preservesContentWords(
      "first item do this second item do that",
      "1. do that\n2. do this"
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

  it("accepts minimal filler removal", () => {
    expect(preservesContentWords("um hello uh world", "Hello, world.")).toBe(true);
  });

  it("protects conversational words as content", () => {
    expect(preservesContentWords(
      "you know so well right okay like",
      "You know so well."
    )).toBe(false);
  });

  it("returns true for empty raw text", () => {
    expect(preservesContentWords("", "anything")).toBe(true);
  });

  it("rejects when a content word disappears", () => {
    expect(preservesContentWords("contact Anthropic support", "contact support")).toBe(false);
  });

  it("detects a duplicate word drop", () => {
    expect(missingContentWords("this is very very good", "This is very good.")).toEqual(["very"]);
  });

  it("forgives enumeration cues only when output has list markers", () => {
    expect(preservesContentWords(
      "point one write the report point two send the update",
      "Write the report. Send the update."
    )).toBe(false);

    expect(preservesContentWords(
      "point one write the report point two send the update",
      "1. Write the report.\n2. Send the update."
    )).toBe(true);
  });

  it("requires spoken cue words when no list marker is present", () => {
    expect(missingContentWords("bullet point write the report", "Write the report.")).toEqual(["bullet", "point"]);
  });

  it("forgives line-break cues when output contains a newline", () => {
    expect(missingContentWords(
      "hello there new paragraph how are you",
      "Hello there.\n\nHow are you?"
    )).toEqual([]);
  });

  it("requires line-break cue words when output has no newline", () => {
    expect(missingContentWords(
      "hello there new paragraph how are you",
      "Hello there how are you"
    )).toEqual(["new", "paragraph"]);
  });

  it("detects added non-numeric answer content", () => {
    expect(addedContentWords(
      "what is the status",
      "What is the status. The answer to your question is 42 because it is ready."
    )).toEqual(["the", "answer", "to", "your", "question", "is", "42", "because", "it", "is", "ready"]);
  });

  it("forgives digits introduced by enumeration cue conversion", () => {
    expect(addedContentWords(
      "point one change provider point two restart",
      "1. Change provider\n2. Restart"
    )).toEqual([]);
  });

  it("counts newly added standalone numbers outside enumeration conversion", () => {
    expect(addedContentWords(
      "change provider and restart",
      "Change provider and restart. 2"
    )).toEqual(["2"]);
  });
});
