import { describe, expect, it } from "vitest";
import { applySelfCorrections } from "@main/text/selfCorrection";
import { removeSpeechNoise } from "@main/text/cleanup";
import { judgeFormatterReply, preservesContentWords } from "@shared/contentGuard";

describe("applySelfCorrections", () => {
  it.each([
    ["Meet at 3, no wait, 4", "Meet at 4"],
    ["Send it to John, sorry, Priya", "Send it to Priya"],
    ["send 5 copies no wait 6 copies", "send 6 copies"],
    ["Let's meet on Friday, no, Thursday.", "Let's meet on Thursday."],
    ["Call Tom today. Meet at 3, I mean, 4.", "Call Tom today. Meet at 4."],
    ["I mean it", "I mean it"],
    ["No, I mean it.", "No, I mean it."],
    ["He said no, Ravi is fine.", "He said no, Ravi is fine."],
    ["meet Monday no wait next Tuesday", "meet Monday no wait next Tuesday"],
    ["Send it by friday, no, the report first.", "Send it by friday, no, the report first."],
    ["Set it to 3.5, no wait, 4.5.", "Set it to 4.5."],
    ["Set the timer to 3.5, no, 4.5 minutes.", "Set the timer to 4.5 minutes."],
    ["I called John, sorry, Mike was busy.", "I called John, sorry, Mike was busy."],
    ["I ordered 3, sorry, 4 were out of stock.", "I ordered 3, sorry, 4 were out of stock."],
    ["Please make that Monday.", "Please make that Monday."],
    ["Version 1.2. Meet at 3, no wait, 4.", "Version 1.2. Meet at 4."],
  ])("%s", (raw, expected) => {
    expect(applySelfCorrections(raw)).toBe(expected);
  });

  it("runs in the fixed-rule fallback", () => {
    expect(removeSpeechNoise("Um, let's meet on Friday, no, Thursday.")).toBe("let's meet on Thursday.");
  });

  it("drops a scratched sentence with the sentence before it", () => {
    expect(applySelfCorrections("I'll be late today. Scratch that. I'll be on time.")).toBe("I'll be on time.");
  });

  it("treats delete that the same, and keeps a lone scratch", () => {
    expect(applySelfCorrections("I'll be late today. Delete that. I'll be on time.")).toBe("I'll be on time.");
    expect(applySelfCorrections("Scratch that.")).toBe("Scratch that.");
  });

  it("leaves scratch inside a sentence alone", () => {
    expect(applySelfCorrections("Please scratch that record off the list.")).toBe("Please scratch that record off the list.");
  });

  it("lets the formatter drop a scratched sentence", () => {
    expect(judgeFormatterReply("I'll be late today. Scratch that. I'll be on time.", "I'll be on time.").rejection).toBeNull();
    // The rest of the guard still applies to what is left.
    expect(judgeFormatterReply("Do not pay 500. Scratch that. Schedule the meeting for 5 p.m. tomorrow.", "Schedule the meeting for 5 pm tomorrow.").rejection).toBeNull();
    expect(judgeFormatterReply("I'll be late. Scratch that. Pay 500 today.", "Pay 600 today.").rejection).not.toBeNull();
  });

  it("keeps dots inside a withdrawn sentence and works across lines", () => {
    expect(applySelfCorrections("Email priya@example.com. Scratch that. Call Priya instead.")).toBe("Call Priya instead.");
    expect(removeSpeechNoise("I will be late.\nScratch that.\nI will be on time.")).toBe("I will be on time.");
  });

  it("withdraws a whole sentence with an abbreviation or a list number", () => {
    expect(applySelfCorrections("Meet at 5 p.m. tomorrow. Scratch that. Call me.")).toBe("Call me.");
    expect(judgeFormatterReply("Meet at 5 p.m. tomorrow. Scratch that. Call me.", "Call me.").rejection).toBeNull();
    expect(applySelfCorrections("1. Buy milk.\n2. Buy eggs.\nScratch that.\n3. Buy bread.")).toBe("1. Buy milk.\n3. Buy bread.");
    expect(judgeFormatterReply("1. Buy milk.\n2. Buy eggs.\nScratch that.\n3. Buy bread.", "1. Buy milk.\n3. Buy bread.").rejection).toBeNull();
  });

  it("splits a list-looking number from a cue on the same line", () => {
    expect(applySelfCorrections("500. Scratch that. Pay 200.")).toBe("Pay 200.");
    expect(removeSpeechNoise("500. Scratch that. Pay 200.")).toBe("Pay 200.");
  });

  it("swaps in a sentence that runs into the next without a space", () => {
    expect(applySelfCorrections("Wait 3.5, no, 4.5 minutes.Next item.")).toBe("Wait 4.5 minutes.Next item.");
    expect(applySelfCorrections("Send 3, no, 4!Next item.")).toBe("Send 4!Next item.");
  });

  it("swaps in a sentence with dots inside a word", () => {
    expect(applySelfCorrections("Send 3, no, 4 emails to priya@example.com.")).toBe("Send 4 emails to priya@example.com.");
    expect(applySelfCorrections("Meet at 3, no, 4 p.m. tomorrow.")).toBe("Meet at 4 p.m. tomorrow.");
    expect(applySelfCorrections("Send 3, no, 4 to Dr. Rao.")).toBe("Send 4 to Dr. Rao.");
    expect(applySelfCorrections("Send it to John, sorry, Dr. Smith.")).toBe("Send it to Dr. Smith.");
    expect(applySelfCorrections("Send it to Dr. John, sorry, Dr. Smith.")).toBe("Send it to Dr. Smith.");
  });

  it("withdraws a sentence that ends in a closing quote or holds a title", () => {
    expect(applySelfCorrections('He said "Do not pay 500." Scratch that. Call me.')).toBe("Call me.");
    expect(applySelfCorrections("Ask Dr. Rao about 500. Scratch that. Call me.")).toBe("Call me.");
  });

  it("withdraws only the sentence before the cue when sentences touch", () => {
    expect(applySelfCorrections("Do not pay 500.Pay 200. Scratch that. Call me.")).toBe("Do not pay 500.Call me.");
    expect(applySelfCorrections("यह सही है।वह गलत है। Scratch that. Call me.")).toBe("यह सही है।Call me.");
    expect(applySelfCorrections("Do not pay 500!2 is enough. Scratch that. Call me.")).toBe("Do not pay 500!Call me.");
    expect(applySelfCorrections("The latency is 500 ms. Pay 200. Scratch that. Call me.")).toBe("The latency is 500 ms. Call me.");
    expect(applySelfCorrections('"Meet at 5 p.m." pay 200. Scratch that. Call me.')).toBe('"Meet at 5 p.m." Call me.');
  });

  it("treats a list number before a cue as an answer, but only for a whole cue", () => {
    expect(applySelfCorrections("500.\u00a0Scratch that. Pay 200.")).toBe("Pay 200.");
    expect(applySelfCorrections("1. Delete that file. Scratch that. 2. Buy milk.")).toBe("2. Buy milk.");
    expect(applySelfCorrections("1. Delete that.txt. Scratch that. 2. Buy milk.")).toBe("2. Buy milk.");
  });

  it("counts a cue that opens with a hesitation", () => {
    expect(applySelfCorrections("Pay 500. Um, scratch that. Pay 200.")).toBe("Pay 200.");
    expect(applySelfCorrections("Pay 500. Um. Scratch that. Pay 200.")).toBe("Pay 200.");
    expect(applySelfCorrections("Pay 500. Um, scratch that. Scratch that. Pay 200.")).not.toContain("500");
  });

  it("swaps inside a quoted sentence", () => {
    expect(applySelfCorrections('He said "Send 3, no, 4."')).toBe('He said "Send 4."');
  });

  it("keeps an abbreviation before a capital as a sentence end, so unclear cuts keep text", () => {
    expect(applySelfCorrections("Meet at 5 p.m. Monday. Scratch that. Call me.")).toBe("Meet at 5 p.m. Call me.");
  });

  it("rejects a dropped sentence without a scratch cue", () => {
    expect(preservesContentWords("I'll be late today. I'll be on time.", "I'll be on time.")).toBe(false);
  });
});
