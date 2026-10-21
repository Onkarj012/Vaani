import { describe, expect, it } from "vitest";
import { isExactMatch, mean, parseExpectedCleanup, percentile, transcriptsFromResults } from "@scripts/ab/cleanupScoring";

describe("parseExpectedCleanup", () => {
  it("reads file name and expected text from table rows", () => {
    const markdown = [
      "| # | File | Say | Expected cleanup | Note |",
      "| --- | --- | --- | --- | --- |",
      "| 01 | `01-short-undo-that.wav` | Undo that. | Undo that. | |",
      "| 23 | `23-list.wav` | First, a. | 1. A.<br>2. B. | list |",
    ].join("\n");
    const expected = parseExpectedCleanup(markdown);
    expect([...expected.keys()]).toEqual(["01-short-undo-that.wav", "23-list.wav"]);
    expect(expected.get("23-list.wav")).toBe("1. A.\n2. B.");
  });

  it("ignores rows that are not clip rows", () => {
    expect(parseExpectedCleanup("| --- | --- |\n| Note | text |").size).toBe(0);
  });
});

describe("isExactMatch", () => {
  it("ignores spacing and blank lines but not case or punctuation", () => {
    expect(isExactMatch("Meet at 4.", "  Meet   at 4.  ")).toBe(true);
    expect(isExactMatch("Meet at 4.", "meet at 4.")).toBe(false);
    expect(isExactMatch("Meet at 4.", "Meet at 4")).toBe(false);
  });

  it("keeps line breaks", () => {
    expect(isExactMatch("1. A.\n2. B.", "1. A. 2. B.")).toBe(false);
  });
});

describe("mean and percentile", () => {
  it("returns null for empty lists", () => {
    expect(mean([])).toBeNull();
    expect(percentile([], 90)).toBeNull();
  });

  it("computes the mean", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it("uses nearest rank", () => {
    const ten = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(ten, 90)).toBe(90);
    expect(percentile(ten, 50)).toBe(50);
    expect(percentile([7], 90)).toBe(7);
  });
});

describe("transcriptsFromResults", () => {
  it("keeps successful rows for one model", () => {
    const parsed = {
      results: [
        { clip: "01.wav", model: "a", ok: true, transcript: "one" },
        { clip: "01.wav", model: "b", ok: true, transcript: "other" },
        { clip: "02.wav", model: "a", ok: false, transcript: "" },
      ],
    };
    expect([...transcriptsFromResults(parsed, "a")]).toEqual([["01.wav", "one"]]);
  });

  it("rejects a file without results", () => {
    expect(() => transcriptsFromResults({ summaries: [] }, "a")).toThrow("not an ab-transcription results file");
  });
});
