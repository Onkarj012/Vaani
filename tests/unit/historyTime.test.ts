import { describe, expect, it } from "vitest";
import type { DictationEntry } from "@shared/types";
import { mapHistoryItems } from "@renderer/context/vaani-ui";
import { formatHistoryTime, localDayKey, msUntilNextLocalDay } from "@renderer/lib/historyDerivations";

const now = new Date(2026, 10, 11, 18, 30, 0);

function entry(timestamp: Date): DictationEntry {
  return {
    id: "entry-1",
    timestamp: timestamp.toISOString(),
    rawText: "hello",
    formattedText: "hello",
    cleanedText: "hello",
    durationSeconds: 4,
    appBundleId: null,
    appName: "Notes",
    injectionStatus: "injected",
    injectionMethod: "clipboard",
    language: "en",
  };
}

describe("formatHistoryTime", () => {
  it("keeps a dictation from today as a clock time", () => {
    expect(formatHistoryTime(new Date(2026, 10, 11, 15, 42).toISOString(), now)).toBe("3:42 PM");
  });

  it("names the calendar day for yesterday and for earlier days this year", () => {
    expect(formatHistoryTime(new Date(2026, 10, 10, 9, 5).toISOString(), now)).toBe("Nov 10, 9:05 AM");
    expect(formatHistoryTime(new Date(2026, 9, 2, 8, 0).toISOString(), now)).toBe("Oct 2, 8:00 AM");
  });

  it("includes the year when the dictation is from another year", () => {
    expect(formatHistoryTime(new Date(2025, 10, 11, 15, 42).toISOString(), now)).toBe("Nov 11, 2025, 3:42 PM");
  });

  it("returns a readable label when the timestamp cannot be parsed", () => {
    expect(formatHistoryTime("not-a-date", now)).toBe("Invalid Date");
  });
});

describe("mapHistoryItems", () => {
  it("shows the dated label on older history rows", () => {
    const [item] = mapHistoryItems([entry(new Date(2026, 10, 10, 9, 5))], now);
    expect(item?.time).toBe("Nov 10, 9:05 AM");
    expect(item?.group).toBe("Yesterday");
  });

  it("moves a same-day dictation off the clock-only label once the calendar day changes", () => {
    const dictatedAt = new Date(2026, 10, 11, 15, 42);
    const [onTheDay] = mapHistoryItems([entry(dictatedAt)], now);
    const [nextMorning] = mapHistoryItems([entry(dictatedAt)], new Date(2026, 10, 12, 8, 0));
    expect(onTheDay?.time).toBe("3:42 PM");
    expect(onTheDay?.group).toBe("Today");
    expect(nextMorning?.time).toBe("Nov 11, 3:42 PM");
    expect(nextMorning?.group).toBe("Yesterday");
  });
});

describe("local day refresh", () => {
  it("names the local calendar day, including the year boundary", () => {
    expect(localDayKey(now)).toBe("2026-11-11");
    expect(localDayKey(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31");
    expect(localDayKey(new Date(2027, 0, 1, 0, 0, 1))).toBe("2027-01-01");
  });

  it("waits until the next local midnight, and at least one millisecond", () => {
    const evening = new Date(2026, 11, 31, 23, 0, 0);
    expect(msUntilNextLocalDay(evening)).toBe(60 * 60 * 1000);
    expect(msUntilNextLocalDay(new Date(2027, 0, 1, 0, 0, 0))).toBe(24 * 60 * 60 * 1000);
  });
});
