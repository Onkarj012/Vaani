import { describe, expect, it } from "vitest";
import type { DictationEntry } from "@shared/types";
import {
  computeEntryFacts,
  createHistoryHaystack,
  deriveStats,
  deriveStreak,
  deriveWeeklyActivity,
  mapDictionaryItems,
} from "@renderer/lib/historyDerivations";

function entry(
  id: string,
  date: Date,
  text: string,
  injectionStatus: "injected" | "saved" = "injected"
): DictationEntry {
  return {
    id,
    timestamp: date.toISOString(),
    rawText: text,
    formattedText: text,
    cleanedText: text,
    durationSeconds: 1,
    appBundleId: null,
    appName: null,
    injectionStatus,
    injectionMethod: injectionStatus === "injected" ? "clipboard" : null,
    language: "en",
  };
}

describe("history derivations", () => {
  const now = new Date(2026, 5, 16, 12);
  const entries = [
    entry("today-1", new Date(2026, 5, 16, 9), "hello world", "injected"),
    entry("today-2", new Date(2026, 5, 16, 10), "ship the update", "saved"),
    entry("yesterday", new Date(2026, 5, 15, 10), "one two three four", "injected"),
    entry("older", new Date(2026, 5, 13, 10), "old words", "injected"),
  ];

  it("derives stats from precomputed entry facts", () => {
    const facts = computeEntryFacts(entries);

    expect(deriveStats(facts, now)).toEqual({
      wordsToday: 5,
      sessionsToday: 2,
      streak: 2,
      accuracy: 75,
      totalWords: 11,
      totalSessions: 4,
    });
  });

  it("derives seven weekly buckets with matching word sums", () => {
    const activity = deriveWeeklyActivity(computeEntryFacts(entries), now);

    expect(activity).toHaveLength(7);
    expect(activity.map((item) => item.words)).toEqual([0, 0, 0, 2, 0, 4, 5]);
    expect(activity.at(-1)?.day).toBe("Tue");
  });

  it("returns zero streak when there is no entry today", () => {
    const facts = computeEntryFacts([
      entry("yesterday", new Date(2026, 5, 15, 10), "one two", "injected"),
    ]);

    expect(deriveStreak(facts, now)).toBe(0);
  });

  it("counts dictionary item usage with word-boundary matching", () => {
    const haystack = createHistoryHaystack([
      entry("one", now, "Open GitHub and then open github", "injected"),
      entry("two", now, "githubish is not a match", "injected"),
    ]);

    expect(mapDictionaryItems([
      { spoken: "github", written: "GitHub" },
      { spoken: "", written: "Blank" },
    ], haystack)).toEqual([
      {
        id: 1,
        word: "github",
        pronunciation: null,
        category: "Correction",
        replacement: "GitHub",
        usageCount: 2,
      },
      {
        id: 2,
        word: "",
        pronunciation: null,
        category: "Correction",
        replacement: "Blank",
        usageCount: 0,
      },
    ]);
  });
});
