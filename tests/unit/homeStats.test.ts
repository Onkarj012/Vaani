import { describe, expect, it } from "vitest";
import type { DictationEntry } from "@shared/types";
import { deriveAppUsage, deriveHomeStats, derivePeakHours, deriveRollingAverage, deriveWordsPerDay } from "@renderer/lib/homeStats";

// Creates a minimal dictation entry for derivation tests.
function makeEntry(id: string, timestamp: Date, text: string, appName: string, injectionStatus: "injected" | "saved" = "injected", durationSeconds = 60): DictationEntry {
  return { id, timestamp: timestamp.toISOString(), rawText: text, formattedText: text, cleanedText: text, durationSeconds, appBundleId: `bundle.${appName}`, appName, injectionStatus, injectionMethod: injectionStatus === "injected" ? "ax" : null, language: "en" };
}

const now = new Date(2026, 10, 7, 12);
const entries = [
  makeEntry("today-a", new Date(2026, 10, 7, 9), "one two three", "Editor", "injected", 60),
  makeEntry("today-b", new Date(2026, 10, 7, 11), "four five", "Mail", "saved", 60),
  makeEntry("yesterday", new Date(2026, 10, 6, 11), "six", "Editor"),
];

describe("home statistics", () => {
  it("derives Home totals and the current streak", () => {
    expect(deriveHomeStats(entries, now)).toMatchObject({ wordsToday: 5, sessionsToday: 2, insertedToday: 1, savedToday: 1, timeSavedMinutes: 0, speakingPace: 3, streak: 2 });
  });

  it("returns one local-day word bucket for each requested day", () => {
    expect(deriveWordsPerDay(entries, 2, now).map(({ words }) => words)).toEqual([1, 5]);
  });

  it("counts words in each local hour", () => {
    const hours = derivePeakHours(entries);
    expect(hours[9]).toBe(3);
    expect(hours[11]).toBe(3);
    expect(hours.reduce((sum, value) => sum + value, 0)).toBe(6);
  });

  it("groups app usage and calculates session shares", () => {
    expect(deriveAppUsage(entries)).toEqual([
      { name: "Editor", bundleId: "bundle.Editor", sessions: 2, words: 4, percent: 67 },
      { name: "Mail", bundleId: "bundle.Mail", sessions: 1, words: 2, percent: 33 },
    ]);
  });

  it("uses available days until the rolling window fills", () => {
    expect(deriveRollingAverage([{ date: "1", label: "", words: 7 }, { date: "2", label: "", words: 14 }])).toEqual([7, 11]);
  });
});
