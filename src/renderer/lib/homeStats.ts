import type { DictationEntry } from "@shared/types";
import { computeEntryFacts, countWords, deriveStreak } from "@renderer/lib/historyDerivations";

export interface DayWords {
  date: string;
  label: string;
  words: number;
}

export interface HomeStats {
  wordsToday: number;
  sessionsToday: number;
  insertedToday: number;
  savedToday: number;
  timeSavedMinutes: number;
  speakingPace: number;
  streak: number;
  days: DayWords[];
}

export interface AppUsage {
  name: string;
  bundleId: string | null;
  sessions: number;
  words: number;
  percent: number;
}

// Creates a stable key for the local calendar day.
function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Counts words per local calendar day for a fixed-width chart range.
export function deriveWordsPerDay(entries: DictationEntry[], days: number, now = new Date()): DayWords[] {
  const dates = Array.from({ length: days }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - index - 1));
    return date;
  });
  return dates.map((date) => {
    const key = localDay(date);
    return {
      date: key,
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      words: entries.reduce((sum, entry) => sum + (localDay(new Date(entry.timestamp)) === key ? countWords(entry.cleanedText) : 0), 0),
    };
  });
}

// Derives Home totals from saved dictations without changing history data.
export function deriveHomeStats(entries: DictationEntry[], now = new Date()): HomeStats {
  const today = localDay(now);
  const todayEntries = entries.filter((entry) => localDay(new Date(entry.timestamp)) === today);
  const wordsToday = todayEntries.reduce((sum, entry) => sum + countWords(entry.cleanedText), 0);
  const speakingMinutes = todayEntries.reduce((sum, entry) => sum + Math.max(0, entry.durationSeconds), 0) / 60;
  return {
    wordsToday,
    sessionsToday: todayEntries.length,
    insertedToday: todayEntries.filter((entry) => entry.injectionStatus === "injected").length,
    savedToday: todayEntries.filter((entry) => entry.injectionStatus === "saved").length,
    timeSavedMinutes: Math.round(wordsToday / 45),
    speakingPace: speakingMinutes > 0 ? Math.round(wordsToday / speakingMinutes) : 0,
    streak: deriveStreak(computeEntryFacts(entries), now),
    days: deriveWordsPerDay(entries, 14, now),
  };
}

// Counts words by local hour for the 24-bar activity chart.
export function derivePeakHours(entries: DictationEntry[]): number[] {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const entry of entries) {
    const hour = new Date(entry.timestamp).getHours();
    hours[hour] = (hours[hour] ?? 0) + countWords(entry.cleanedText);
  }
  return hours;
}

// Groups dictations by app and reports each app's share of the selected range.
export function deriveAppUsage(entries: DictationEntry[]): AppUsage[] {
  const apps = new Map<string, AppUsage>();
  for (const entry of entries) {
    const name = entry.appName?.trim() || "Unknown";
    const current = apps.get(name) ?? { name, bundleId: entry.appBundleId, sessions: 0, words: 0, percent: 0 };
    current.sessions += 1;
    current.words += countWords(entry.cleanedText);
    apps.set(name, current);
  }
  const allApps = [...apps.values()].sort((a, b) => b.sessions - a.sessions);
  const total = entries.length;
  const result = allApps.slice(0, 7).map((app) => ({ ...app, percent: Math.round((app.sessions / total) * 100) }));
  const otherApps = allApps.slice(7);
  const otherSessions = otherApps.reduce((sum, app) => sum + app.sessions, 0);
  if (otherSessions > 0) result.push({
    name: "Other",
    bundleId: null,
    sessions: otherSessions,
    words: otherApps.reduce((sum, app) => sum + app.words, 0),
    percent: Math.round((otherSessions / total) * 100),
  });
  return result;
}

// Averages each day with the six days before it for a rolling activity line.
export function deriveRollingAverage(days: DayWords[], windowSize = 7): number[] {
  return days.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const window = days.slice(start, index + 1);
    return window.length ? Math.round(window.reduce((sum, day) => sum + day.words, 0) / window.length) : 0;
  });
}
