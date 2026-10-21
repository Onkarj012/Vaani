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

  it("swaps in a sentence that runs into the next without a space", () => {
    expect(applySelfCorrections("Wait 3.5, no, 4.5 minutes.Next item.")).toBe("Wait 4.5 minutes.Next item.");
  });

  it("rejects a dropped sentence without a scratch cue", () => {
    expect(preservesContentWords("I'll be late today. I'll be on time.", "I'll be on time.")).toBe(false);
  });
});
