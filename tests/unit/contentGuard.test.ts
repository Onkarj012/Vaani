import { describe, expect, it } from "vitest";
import { addedContentWords, missingContentWords, preservesContentWords, stripReasoningBlocks } from "../../src/shared/contentGuard";

describe("preservesContentWords", () => {
  it("accepts punctuation and capitalization changes", () => {
    expect(preservesContentWords("hello world", "Hello, world.")).toBe(true);
  });

  it("rejects an added negation that flips the meaning", () => {
    expect(preservesContentWords("send the report today", "Do not send the report today.")).toBe(false);
    expect(addedContentWords("send the report today", "Do not send the report today.")).toEqual(["do", "not"]);
  });

  it("rejects a dropped Devanagari word", () => {
    expect(missingContentWords("मुझे कल ऑफिस जाना है", "मुझे ऑफिस जाना है।")).toEqual(["कल"]);
  });

  it("accepts Devanagari punctuation and keeps combining marks with their letters", () => {
    expect(preservesContentWords("मुझे कल ऑफिस जाना है", "मुझे, कल ऑफिस जाना है।")).toBe(true);
  });

  it("rejects words moved out of order", () => {
    expect(preservesContentWords("we ship it Tuesday", "Tuesday, we ship it.")).toBe(false);
    expect(preservesContentWords("we ship it Tuesday", "We ship it Tuesday.")).toBe(true);
  });

  it("rejects a dropped word", () => {
    expect(preservesContentWords("contact Anthropic support", "contact support")).toBe(false);
  });

  it("detects a repeated word that was collapsed", () => {
    expect(missingContentWords("this is very very good", "This is very good.")).toEqual(["very"]);
  });

  it("accepts minimal filler removal", () => {
    expect(preservesContentWords("um hello uh world", "Hello, world.")).toBe(true);
  });

  it("accepts number-word to digit conversion", () => {
    expect(preservesContentWords("I have twenty items", "I have 20 items.")).toBe(true);
  });

  it("rejects output words when the raw text is empty", () => {
    expect(preservesContentWords("", "anything")).toBe(false);
    expect(preservesContentWords("", "...")).toBe(true);
  });

  it("accepts a dictated new paragraph turned into a line break", () => {
    expect(preservesContentWords("hello there new paragraph how are you", "Hello there.\n\nHow are you?")).toBe(true);
  });

  it("requires the cue words when there is no line break", () => {
    expect(missingContentWords("hello there new paragraph how are you", "Hello there how are you")).toEqual(["new", "paragraph"]);
  });

  it("accepts a dictated enumeration formatted as a list", () => {
    expect(preservesContentWords(
      "point one write the report point two send the update",
      "1. Write the report.\n2. Send the update."
    )).toBe(true);
  });

  it("requires enumeration cue words when the output has no list", () => {
    expect(preservesContentWords(
      "point one write the report point two send the update",
      "Write the report. Send the update."
    )).toBe(false);
  });

  it("reports added content words that are not in the raw text", () => {
    expect(addedContentWords(
      "what is the status",
      "What is the status. The answer is 42."
    )).toEqual(["the", "answer", "is", "42"]);
  });
});

describe("stripReasoningBlocks", () => {
  it("removes closed reasoning blocks", () => {
    expect(stripReasoningBlocks("<think>I will drop words</think>Send the report today.")).toBe("Send the report today.");
  });

  it("removes an unclosed reasoning block to the end", () => {
    expect(stripReasoningBlocks("Send the report <thinking>maybe")).toBe("Send the report");
  });
});
