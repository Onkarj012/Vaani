import { describe, expect, it } from "vitest";
import { judgeFormatterReply } from "@shared/contentGuard";

const verdict = (raw: string, reply: string) => judgeFormatterReply(raw, reply, [], { speechNoise: true }).rejection;

describe("judgeFormatterReply with cleanup on", () => {
  it.each([
    ["a number replaced after a correction cue", "Set the timer to 3.5, no, 4.5 minutes", "Set the timer to 4.5 minutes."],
    ["one dropped small word", "Give me a simple text box with either lists or paragraphs", "Give me a simple text box with lists or paragraphs."],
    ["reordered words", "Why does after successful insertion why does a sentence appear", "Why does a sentence appear after successful insertion?"],
    ["an ordinal written as its number", "the second item is ready", "The 2 item is ready."],
    ["a cleaned Title Case reply", "The Spare Keys Under the Blue Flower Pot", "The spare keys under the blue flower pot."],
  ])("accepts %s", (_case, raw, reply) => {
    expect(verdict(raw, reply)).toBeNull();
  });

  it.each([
    ["a dropped number", "ship 2 boxes on Tuesday", "Ship boxes on Tuesday.", "The formatter changed a number or a negation."],
    ["a changed number", "ship 2 boxes on Tuesday", "Ship 3 boxes on Tuesday.", "The formatter changed a number or a negation."],
    ["a dropped negation", "I do not want the dark theme", "I do want the dark theme.", "The formatter changed a number or a negation."],
    ["an added negation", "I want the dark theme", "I don't want the dark theme.", "The formatter changed a number or a negation."],
    ["added sentences", "send the report today", "Send the report today. Let me know if you need anything else.", "The formatter added words the speaker did not say."],
    ["a large drop", "please send the full quarterly report to the team today", "Send the report.", "The formatter dropped too many words."],
  ])("rejects %s", (_case, raw, reply, reason) => {
    expect(verdict(raw, reply)).toBe(reason);
  });

  it("keeps every word when cleanup is off", () => {
    expect(judgeFormatterReply("give me either one", "Give me one.", [], { speechNoise: false }).rejection).toBe("The formatter changed words in the transcript.");
  });
});
