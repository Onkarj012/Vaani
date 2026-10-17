import { describe, expect, it } from "vitest";
import type { Settings } from "@shared/types";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import { cleanupText, deterministicFormat } from "@main/text/cleanup";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  cleanupEnabled: true,
  smartPunctuation: true,
  fillerWords: [],
  customCorrections: [],
  snippets: [],
};

describe("question punctuation and spoken file names", () => {
  it.each([
    ["what is this", "What is this?"],
    ["how do I fix it", "How do I fix it?"],
    ["can you check what is correct and wrong", "Can you check what is correct and wrong?"],
    ["do this in a temp file", "Do this in a temp file."],
    ["what I want is a refund", "What I want is a refund."],
    ["is it done", "Is it done?"],
    ["send it now.", "Send it now."],
    ["is it done?", "Is it done?"],
    ["ship it!", "Ship it!"],
    ["send it. what is this", "Send it. What is this?"],
    ["update package dot json", "Update package.json."],
    ["open dictation dot ts", "Open dictation.ts."],
    ["the dot is red", "The dot is red."],
    ["don't you dare touch that", "Don't you dare touch that."],
    ["may your day be wonderful", "May your day be wonderful."],
    ["may I come in", "May I come in?"],
    ["what is needed is a temp file", "What is needed is a temp file."],
    ["what’s your name", "What’s your name?"],
    ["who wrote this", "Who wrote this?"],
    ["how many files are there", "How many files are there?"],
    ["which file changed", "Which file changed?"],
    ["open vite dot config dot ts", "Open vite.config.ts."],
    ["open src/index dot ts", "Open src/index.ts."],
  ])("cleans %j to %j", (rawText, expected) => {
    expect(cleanupText({ rawText, settings })).toBe(expected);
  });

  it("gives the LLM-fallback formatter a question mark too", () => {
    expect(deterministicFormat("what is this")).toBe("What is this?");
  });
});
