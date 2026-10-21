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

  it("distinguishes relative-clause questions from what-is statements", () => {
    for (const [rawText, expected] of [
      ["what is it that is failing", "What is it that is failing?"],
      ["what is required for this task is a new tool", "What is required for this task is a new tool."],
    ] satisfies [string, string][]) {
      expect(cleanupText({ rawText, settings })).toBe(expected);
      expect(deterministicFormat(rawText)).toBe(expected);
    }
  });

  it("keeps common abbreviations inside the final question", () => {
    for (const [rawText, expected] of [
      ["how is Dr. Smith", "How is Dr. Smith?"],
      ["send it. how is Mrs. Smith", "Send it. How is Mrs. Smith?"],
      ["how is Dr. Smith? send it", "How is Dr. Smith? Send it."],
      ["send it to John Jr. is it ready", "Send it to John Jr. Is it ready?"],
      ["where is St. Louis", "Where is St. Louis?"],
      ["where is Mount St. Helens", "Where is Mount St. Helens?"],
      ["where is st. louis", "Where is St. Louis?"],
      ["who won India vs. Australia", "Who won India vs. Australia?"],
    ] satisfies [string, string][]) {
      expect(cleanupText({ rawText, settings })).toBe(expected);
      expect(deterministicFormat(rawText)).toBe(expected);
    }
  });

  it("leaves st. alone inside filenames, URLs and counts", () => {
    for (const [rawText, expected] of [
      ["open test.st. then run it", "Open test.st. Then run it."],
      ["open https://example.com/st. then continue", "Open https://example.com/st. Then continue."],
      ["open https://example.com/(st. then continue", "Open https://example.com/(st. Then continue."],
      ["vi behöver 3 st. M6-skruvar", "Vi behöver 3 st. M6-skruvar."],
      ["vi behöver 3  st. M6-skruvar", "Vi behöver 3 st. M6-skruvar."],
      ["we visited (st. louis) yesterday", "We visited (St. Louis) yesterday."],
      ["where is st. louis\nwhere is st. paul", "Where is St. Louis?\nWhere is St. Paul?"],
    ] satisfies [string, string][]) {
      expect(cleanupText({ rawText, settings })).toBe(expected);
    }
  });

  it("recognizes short questions with contracted who openers", () => {
    for (const [rawText, expected] of [
      ["who's there", "Who's there?"],
      ["who’s there", "Who’s there?"],
      ["who're they", "Who're they?"],
    ] satisfies [string, string][]) {
      expect(cleanupText({ rawText, settings })).toBe(expected);
      expect(deterministicFormat(rawText)).toBe(expected);
    }
  });
});
