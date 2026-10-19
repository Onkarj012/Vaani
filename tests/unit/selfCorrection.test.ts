import { describe, expect, it } from "vitest";
import { applySelfCorrections } from "@main/text/selfCorrection";
import { removeSpeechNoise } from "@main/text/cleanup";

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
    ["Set it to 3.5, no wait, 4.5.", "Set it to 3.5, no wait, 4.5."],
    ["Please make that Monday.", "Please make that Monday."],
    ["Version 1.2. Meet at 3, no wait, 4.", "Version 1.2. Meet at 4."],
  ])("%s", (raw, expected) => {
    expect(applySelfCorrections(raw)).toBe(expected);
  });

  it("runs in the fixed-rule fallback", () => {
    expect(removeSpeechNoise("Um, let's meet on Friday, no, Thursday.")).toBe("let's meet on Thursday.");
  });
});
