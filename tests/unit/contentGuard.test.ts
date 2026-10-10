import { describe, expect, it } from "vitest";
import { addedContentWords, missingContentWords, preservesContentWords, stripReasoningBlocks } from "../../src/shared/contentGuard";

describe("preservesContentWords", () => {
  it("accepts punctuation and capitalization changes", () => {
    expect(preservesContentWords("hello world", "Hello, world.", [])).toBe(true);
  });

  it("rejects an added negation that flips the meaning", () => {
    expect(preservesContentWords("send the report today", "Do not send the report today.", [])).toBe(false);
    expect(addedContentWords("send the report today", "Do not send the report today.", [])).toEqual(["do", "not"]);
  });

  it("rejects a dropped Devanagari word", () => {
    expect(missingContentWords("मुझे कल ऑफिस जाना है", "मुझे ऑफिस जाना है।", [])).toEqual(["कल"]);
  });

  it("accepts Devanagari punctuation and keeps combining marks with their letters", () => {
    expect(preservesContentWords("मुझे कल ऑफिस जाना है", "मुझे, कल ऑफिस जाना है।", [])).toBe(true);
  });

  it("rejects words moved out of order", () => {
    expect(preservesContentWords("we ship it Tuesday", "Tuesday, we ship it.", [])).toBe(false);
    expect(preservesContentWords("we ship it Tuesday", "We ship it Tuesday.", [])).toBe(true);
  });

  it("rejects a dropped word", () => {
    expect(preservesContentWords("contact Anthropic support", "contact support", [])).toBe(false);
  });

  it("detects a repeated word that was collapsed", () => {
    expect(missingContentWords("this is very very good", "This is very good.", [])).toEqual(["very"]);
  });

  it("accepts dropping a listed filler", () => {
    expect(preservesContentWords("um hello uh world", "Hello, world.", ["um", "uh"])).toBe(true);
    expect(preservesContentWords("I have twenty um one item", "I have twenty one item.", ["um"])).toBe(true);
    expect(preservesContentWords("you know hello world", "Hello world.", ["you know"])).toBe(true);
  });

  it("rejects dropping a filler that is not listed", () => {
    expect(preservesContentWords("um hello uh world", "Hello, world.", [])).toBe(false);
    expect(missingContentWords("um hello uh world", "Hello, world.", [])).toEqual(["um", "uh"]);
  });

  it("rejects a filler the output adds", () => {
    expect(preservesContentWords("hello world", "Um, hello world.", ["um"])).toBe(false);
    expect(addedContentWords("hello world", "Um, hello world.", ["um"])).toEqual(["um"]);
  });

  it("accepts number-word to digit conversion", () => {
    expect(preservesContentWords("I have twenty items", "I have 20 items.", [])).toBe(true);
  });

  it("rejects output words when the raw text is empty", () => {
    expect(preservesContentWords("", "anything", [])).toBe(false);
    expect(preservesContentWords("", "...", [])).toBe(true);
  });

  it("accepts a dictated new paragraph turned into a line break", () => {
    expect(preservesContentWords("hello there new paragraph how are you", "Hello there.\n\nHow are you?", [])).toBe(true);
  });

  it("requires the cue words when there is no line break", () => {
    expect(missingContentWords("hello there new paragraph how are you", "Hello there how are you", [])).toEqual(["new", "paragraph"]);
  });

  it("accepts a dictated enumeration formatted as a list", () => {
    expect(preservesContentWords(
      "point one write the report point two send the update",
      "1. Write the report.\n2. Send the update.",
      [],
    )).toBe(true);
  });

  it("requires enumeration cue words when the output has no list", () => {
    expect(preservesContentWords(
      "point one write the report point two send the update",
      "Write the report. Send the update.",
      [],
    )).toBe(false);
  });

  it("reports added content words that are not in the raw text", () => {
    expect(addedContentWords(
      "what is the status",
      "What is the status. The answer is 42.",
      [],
    )).toEqual(["the", "answer", "is", "42"]);
  });

  it("rejects a decimal number split into two numbers", () => {
    expect(preservesContentWords("set ratio to 1.5", "Set ratio to 1.5.", [])).toBe(true);
    expect(preservesContentWords("set ratio to 1.5", "Set ratio to 1 5.", [])).toBe(false);
    expect(missingContentWords("set ratio to 1.5", "Set ratio to 1 5.", [])).toEqual(["1.5"]);
  });

  it("keeps thousands separators and times whole", () => {
    expect(preservesContentWords("pay 1,000 at 10:30", "Pay 1,000 at 10:30.", [])).toBe(true);
    expect(preservesContentWords("pay 1,000 at 10:30", "Pay 1 000 at 10:30.", [])).toBe(false);
  });

  it("rejects a compound spelled number split into digits", () => {
    expect(preservesContentWords("I have twenty one items", "I have twenty one items.", [])).toBe(true);
    expect(preservesContentWords("I have twenty one items", "I have 20 1 items.", [])).toBe(false);
  });

  it("rejects a dictated number dropped from a list that the output numbers", () => {
    const raw = "I bought a number two pencil point one write the report point two send it";
    expect(preservesContentWords(raw, "I bought a pencil.\n1. Write the report.\n2. Send it.", [])).toBe(false);
    expect(missingContentWords(raw, "I bought a pencil.\n1. Write the report.\n2. Send it.", [])).toEqual(["number", "two"]);
  });

  it("accepts dictated bullet points formatted as a bullet list", () => {
    expect(preservesContentWords(
      "bullet point milk bullet point eggs",
      "- Milk\n- Eggs",
      [],
    )).toBe(true);
  });

  it("rejects a line break the output places away from the cue", () => {
    expect(preservesContentWords("hello there new paragraph how are you", "Hello there how are you?\n\n", [])).toBe(false);
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
