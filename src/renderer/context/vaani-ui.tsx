import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode
} from "react";
import type { DictationEntry, DictationState, Settings } from "@shared/types";
import { DEFAULT_SETTINGS } from "@shared/defaults";

export type ThemeId = "aurora";

export interface HistoryItemView {
  id: string;
  group: string;
  time: string;
  text: string;
  duration: string;
  wordCount: number;
  app: string;
}

export interface WordHistoryView {
  id: string;
  text: string;
  timestamp: string;
  duration: string;
  app: string;
}

export interface DictionaryItemView {
  id: number;
  word: string;
  pronunciation: string | null;
  category: "Technical" | "Brand" | "Correction";
  replacement: string | null;
  usageCount: number;
}

export interface UserDictionaryView {
  word: string;
  replacement: string;
  category: "technical" | "brand" | "correction";
}

export interface SnippetView {
  trigger: string;
  content: string;
}

interface StatsView {
  wordsToday: number;
  sessionsToday: number;
  streak: number;
  accuracy: number;
  totalWords: number;
  totalSessions: number;
}

interface WeeklyActivityView {
  day: string;
  words: number;
}

interface HistoryModel {
  entries: DictationEntry[];
  loading: boolean;
  reload: () => Promise<void>;
  updateEntry: (id: string, cleanedText: string) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  reinjectEntry: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

interface VaaniUiContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  dictation: DictationState;
  bars: number[];
  settings: Settings;
  settingsLoading: boolean;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  resetSettings: () => Promise<void>;
  historyLoading: boolean;
  historyEntries: DictationEntry[];
  historyItems: HistoryItemView[];
  wordHistory: WordHistoryView[];
  stats: StatsView;
  weeklyActivity: WeeklyActivityView[];
  dictionaryItems: DictionaryItemView[];
  userDictionary: UserDictionaryView[];
  snippets: SnippetView[];
  reloadHistory: () => Promise<void>;
  updateHistoryEntry: (id: string, cleanedText: string) => Promise<void>;
  deleteHistoryEntry: (id: string) => Promise<void>;
  reinjectHistoryEntry: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  copyHistoryEntry: (text: string) => Promise<void>;
  addDictionaryWord: (input: { word: string; replacement?: string; category?: string }) => Promise<void>;
  removeDictionaryWord: (word: string) => Promise<void>;
  addSnippet: (input: { trigger: string; content: string }) => Promise<void>;
  removeSnippet: (trigger: string) => Promise<void>;
}

const VaaniUiContext = createContext<VaaniUiContextValue | null>(null);

export function VaaniUiProvider({
  children,
  dictation,
  bars,
  settings,
  settingsLoading,
  updateSettings,
  history
}: {
  children: ReactNode;
  dictation: DictationState;
  bars: number[];
  settings: Settings;
  settingsLoading: boolean;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  history: HistoryModel;
}) {
  // Aurora is the only theme. Older settings values are migrated transparently.
  const theme: ThemeId = "aurora";

  const setTheme = useCallback((nextTheme: ThemeId) => {
    void updateSettings({ theme: nextTheme });
  }, [updateSettings]);

  // Apply accent color CSS variable whenever settings.accentColor changes
  useEffect(() => {
    const color = settings.accentColor;
    if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
      document.documentElement.style.setProperty("--accent", color);
    }
  }, [settings.accentColor]);

  const resetSettings = useCallback(async () => {
    await updateSettings(DEFAULT_SETTINGS);
  }, [updateSettings]);

  const copyHistoryEntry = useCallback(async (text: string) => {
    await window.vaani.copyText(text);
  }, []);

  const addDictionaryWord = useCallback(async ({
    word,
    replacement
  }: {
    word: string;
    replacement?: string;
    category?: string;
  }) => {
    const spokenNorm = normalizeDictionaryValue(word.trim());
    if (!spokenNorm) return;
    const writtenNorm = normalizeDictionaryValue(replacement?.trim() || spokenNorm);
    const current = settings.customCorrections ?? [];
    const exists = current.findIndex((c) => c.spoken.toLowerCase() === spokenNorm.toLowerCase());
    const next = exists >= 0
      ? current.map((c, index) => index === exists ? { ...c, written: writtenNorm } : c)
      : [...current, { spoken: spokenNorm, written: writtenNorm }];
    await updateSettings({ customCorrections: next });
  }, [settings.customCorrections, updateSettings]);

  const removeDictionaryWord = useCallback(async (spoken: string) => {
    const next = (settings.customCorrections ?? []).filter(
      (correction) => correction.spoken.toLowerCase() !== spoken.trim().toLowerCase()
    );
    await updateSettings({ customCorrections: next });
  }, [settings.customCorrections, updateSettings]);

  const addSnippet = useCallback(async ({
    trigger,
    content
  }: {
    trigger: string;
    content: string;
  }) => {
    const t = normalizeSnippetValue(trigger.trim());
    if (!t) return;
    const c = normalizeSnippetValue(content.trim());
    const current = settings.snippets ?? [];
    const exists = current.findIndex((s) => s.trigger.toLowerCase() === t.toLowerCase());
    const next = exists >= 0
      ? current.map((s, index) => index === exists ? { ...s, content: c } : s)
      : [...current, { trigger: t, content: c }];
    await updateSettings({ snippets: next });
  }, [settings.snippets, updateSettings]);

  const removeSnippet = useCallback(async (trigger: string) => {
    const next = (settings.snippets ?? []).filter(
      (s) => s.trigger.toLowerCase() !== trigger.trim().toLowerCase()
    );
    await updateSettings({ snippets: next });
  }, [settings.snippets, updateSettings]);

  const historyItems = useMemo(() => mapHistoryItems(history.entries), [history.entries]);
  const wordHistory = useMemo(() => mapWordHistory(history.entries), [history.entries]);
  const stats = useMemo(() => deriveStats(history.entries), [history.entries]);
  const weeklyActivity = useMemo(() => deriveWeeklyActivity(history.entries), [history.entries]);
  const dictionaryItems = useMemo(
    () => mapDictionaryItems(settings.customCorrections ?? [], history.entries),
    [history.entries, settings.customCorrections]
  );
  const userDictionary = useMemo(
    () => mapUserDictionary(settings.customCorrections ?? []),
    [settings.customCorrections]
  );
  const snippets = useMemo(
    () => mapSnippets(settings.snippets ?? []),
    [settings.snippets]
  );

  const value = useMemo<VaaniUiContextValue>(() => ({
    theme,
    setTheme,
    dictation,
    bars,
    settings,
    settingsLoading,
    updateSettings,
    resetSettings,
    historyLoading: history.loading,
    historyEntries: history.entries,
    historyItems,
    wordHistory,
    stats,
    weeklyActivity,
    dictionaryItems,
    userDictionary,
    snippets,
    reloadHistory: history.reload,
    updateHistoryEntry: history.updateEntry,
    deleteHistoryEntry: history.deleteEntry,
    reinjectHistoryEntry: history.reinjectEntry,
    clearHistory: history.clearAll,
    copyHistoryEntry,
    addDictionaryWord,
    removeDictionaryWord,
    addSnippet,
    removeSnippet
  }), [
    addDictionaryWord,
    addSnippet,
    bars,
    copyHistoryEntry,
    dictation,
    dictionaryItems,
    history,
    historyItems,
    removeDictionaryWord,
    removeSnippet,
    resetSettings,
    settings,
    settingsLoading,
    setTheme,
    snippets,
    theme,
    updateSettings,
    userDictionary,
    weeklyActivity,
    wordHistory,
    stats
  ]);

  return <VaaniUiContext.Provider value={value}>{children}</VaaniUiContext.Provider>;
}

export function useVaaniUi(): VaaniUiContextValue {
  const context = useContext(VaaniUiContext);
  if (!context) {
    throw new Error("useVaaniUi must be used within a VaaniUiProvider");
  }
  return context;
}

// Theme is now stored in settings on disk — no localStorage needed.

function normalizeDictionaryValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSnippetValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function mapSnippets(snippets: Array<{ trigger: string; content: string }>): SnippetView[] {
  return snippets.map(({ trigger, content }) => ({
    trigger: trigger.trim(),
    content: content.trim()
  }));
}

function mapHistoryItems(entries: DictationEntry[]): HistoryItemView[] {
  return [...entries]
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .map((entry) => ({
      id: entry.id,
      group: groupForTimestamp(entry.timestamp),
      time: formatDisplayTime(entry.timestamp),
      text: entry.cleanedText,
      duration: formatShortDuration(entry.durationSeconds),
      wordCount: countWords(entry.cleanedText),
      app: normalizeAppName(entry.appName)
    }));
}

function mapWordHistory(entries: DictationEntry[]): WordHistoryView[] {
  return [...entries]
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .map((entry) => ({
      id: entry.id,
      text: entry.cleanedText,
      timestamp: formatTerminalTimestamp(entry.timestamp),
      duration: formatLongDuration(entry.durationSeconds),
      app: normalizeTerminalApp(entry.appName)
    }));
}

function mapDictionaryItems(
  corrections: Array<{ spoken: string; written: string }>,
  entries: DictationEntry[]
): DictionaryItemView[] {
  const haystack = entries.map((entry) => entry.cleanedText.toLowerCase()).join(" ");
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

function mapUserDictionary(corrections: Array<{ spoken: string; written: string }>): UserDictionaryView[] {
  return corrections.map(({ spoken, written }) => ({
    word: spoken,
    replacement: written,
    category: "correction" as const
  }));
}

function deriveStats(entries: DictationEntry[]): StatsView {
  const now = new Date();
  const totalWords = entries.reduce((sum, entry) => sum + countWords(entry.cleanedText), 0);
  const todayEntries = entries.filter((entry) => isSameDay(new Date(entry.timestamp), now));

  return {
    wordsToday: todayEntries.reduce((sum, entry) => sum + countWords(entry.cleanedText), 0),
    sessionsToday: todayEntries.length,
    streak: deriveStreak(entries),
    accuracy: 98.2,
    totalWords,
    totalSessions: entries.length
  };
}

function deriveWeeklyActivity(entries: DictationEntry[]): WeeklyActivityView[] {
  const end = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (6 - index));
    return date;
  });

  return days.map((date) => ({
    day: date.toLocaleDateString("en-US", { weekday: "short" }),
    words: entries
      .filter((entry) => isSameDay(new Date(entry.timestamp), date))
      .reduce((sum, entry) => sum + countWords(entry.cleanedText), 0)
  }));
}

function deriveStreak(entries: DictationEntry[]): number {
  const uniqueDays = Array.from(new Set(entries.map((entry) => startOfDay(new Date(entry.timestamp)).toISOString()))).sort().reverse();
  let streak = 0;
  let cursor = startOfDay(new Date());

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

function formatDisplayTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatShortDuration(durationSeconds: number): string {
  const totalSeconds = Math.max(0, Math.round(durationSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatLongDuration(durationSeconds: number): string {
  const totalSeconds = Math.max(0, Math.round(durationSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatTerminalTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (isSameDay(date, now)) {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return `YESTERDAY_${date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    })}`;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  }).toUpperCase();
}

function groupForTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, now)) {
    return "Today";
  }
  if (isSameDay(date, yesterday)) {
    return "Yesterday";
  }

  const startOfWeek = startOfDay(new Date(now));
  startOfWeek.setDate(now.getDate() - 6);
  return date >= startOfWeek ? "This Week" : "Earlier";
}

function normalizeAppName(appName: string | null): string {
  return appName?.trim() || "Unknown";
}

function normalizeTerminalApp(appName: string | null): string {
  return normalizeAppName(appName).replace(/\s+/g, "_").toUpperCase();
}

function countWords(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words?.length ?? 0;
}

function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
