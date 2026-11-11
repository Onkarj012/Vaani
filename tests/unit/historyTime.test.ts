import { describe, expect, it } from "vitest";
import type { DictationEntry } from "@shared/types";
import { mapHistoryItems } from "@renderer/context/vaani-ui";
import { formatHistoryTime } from "@renderer/lib/historyDerivations";

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
});
