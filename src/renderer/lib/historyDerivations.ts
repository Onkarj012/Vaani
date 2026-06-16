import type { DictationEntry } from "@shared/types";

export interface DictionaryItemView {
  id: number;
  word: string;
  pronunciation: string | null;
  category: "Technical" | "Brand" | "Correction";
  replacement: string | null;
  usageCount: number;
}

export interface StatsView {
  wordsToday: number;
  sessionsToday: number;
  streak: number;
  accuracy: number;
  totalWords: number;
  totalSessions: number;
}

export interface WeeklyActivityView {
  day: string;
  words: number;
}

export interface EntryFacts {
  wordCount: number;
  localDayIso: string;
  injected: boolean;
  timestamp: number;
}

export function countWords(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words?.length ?? 0;
}

export function computeEntryFacts(entries: DictationEntry[]): EntryFacts[] {
  return entries.map((entry) => {
    const date = new Date(entry.timestamp);
    return {
      wordCount: countWords(entry.cleanedText),
      localDayIso: startOfDay(date).toISOString(),
      injected: entry.injectionStatus === "injected",
      timestamp: date.getTime(),
    };
  });
}

export function createHistoryHaystack(entries: DictationEntry[]): string {
  return entries.map((entry) => entry.cleanedText.toLowerCase()).join(" ");
}

export function mapDictionaryItems(
  corrections: Array<{ spoken: string; written: string }>,
  haystack: string
): DictionaryItemView[] {
  return corrections.map(({ spoken, written }, index) => {
    const normalized = spoken.trim();
    const escaped = escapeRegExp(normalized.toLowerCase());
    const usageCount = normalized ? (haystack.match(new RegExp(`\\b${escaped}\\b`, "g"))?.length ?? 0) : 0;
    return {
      id: index + 1,
      word: normalized,
      pronunciation: null,
      category: "Correction" as const,
      replacement: written.trim(),
      usageCount
    };
  });
}

export function deriveStats(facts: EntryFacts[], now = new Date()): StatsView {
  const todayIso = startOfDay(now).toISOString();
  const totalWords = facts.reduce((sum, fact) => sum + fact.wordCount, 0);
  const todayFacts = facts.filter((fact) => fact.localDayIso === todayIso);
  const successfulInjections = facts.filter((fact) => fact.injected).length;
  const accuracy = facts.length > 0 ? Math.round((successfulInjections / facts.length) * 100) : 0;

  return {
    wordsToday: todayFacts.reduce((sum, fact) => sum + fact.wordCount, 0),
    sessionsToday: todayFacts.length,
    streak: deriveStreak(facts, now),
    accuracy,
    totalWords,
    totalSessions: facts.length
  };
}

export function deriveWeeklyActivity(facts: EntryFacts[], now = new Date()): WeeklyActivityView[] {
  const end = startOfDay(now);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (6 - index));
    return date;
  });

  return days.map((date) => {
    const dayIso = startOfDay(date).toISOString();
    return {
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      words: facts
        .filter((fact) => fact.localDayIso === dayIso)
        .reduce((sum, fact) => sum + fact.wordCount, 0)
    };
  });
}

export function deriveStreak(facts: EntryFacts[], now = new Date()): number {
  const uniqueDays = Array.from(new Set(facts.map((fact) => fact.localDayIso))).sort().reverse();
  let streak = 0;
  let cursor = startOfDay(now);

  for (const dayIso of uniqueDays) {
    const day = new Date(dayIso);
    if (day.getTime() === cursor.getTime()) {
      streak += 1;
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }

    if (day.getTime() < cursor.getTime()) {
      break;
    }
  }

  return streak;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
