import { app } from "electron";
import { join } from "node:path";
import { APP_DATA_DIR, HISTORY_LIMIT } from "@shared/defaults";
import type { DictationEntry } from "@shared/types";
import { readJsonFile, writeJsonFile } from "./base";

export class HistoryStore {
  private readonly filePath: string;

  constructor(filePath = join(app.getPath("home"), APP_DATA_DIR, "history.json")) {
    this.filePath = filePath;
  }

  async getAll(): Promise<DictationEntry[]> {
    const raw = await readJsonFile<unknown>(this.filePath, []);
    return normalizeHistory(raw);
  }

  async append(entry: DictationEntry): Promise<void> {
    const history = await this.getAll();
    const next = [entry, ...history].slice(0, HISTORY_LIMIT);
    await writeJsonFile(this.filePath, next);
  }

  async delete(id: string): Promise<void> {
    const history = await this.getAll();
    await writeJsonFile(this.filePath, history.filter(e => e.id !== id));
  }

  async clear(): Promise<void> {
    await writeJsonFile(this.filePath, []);
  }

  async getById(id: string): Promise<DictationEntry | undefined> {
    const history = await this.getAll();
    return history.find(e => e.id === id);
  }

  async getLatest(): Promise<DictationEntry | undefined> {
    const history = await this.getAll();
    return history[0];
  }

  async updateById(id: string, updater: (entry: DictationEntry) => DictationEntry): Promise<DictationEntry | undefined> {
    const history = await this.getAll();
    let updatedEntry: DictationEntry | undefined;

    const next = history.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }

      updatedEntry = updater(entry);
      return updatedEntry;
    });

    if (!updatedEntry) {
      return undefined;
    }

    await writeJsonFile(this.filePath, next);
    return updatedEntry;
  }
}

function normalizeHistory(raw: unknown): DictationEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
    .map(e => ({
      id: typeof e.id === "string" ? e.id : crypto.randomUUID(),
      timestamp: typeof e.timestamp === "string" ? e.timestamp : new Date().toISOString(),
      rawText: typeof e.rawText === "string" ? e.rawText : "",
      formattedText: typeof e.formattedText === "string"
        ? e.formattedText
        : (typeof e.rawText === "string" ? e.rawText : ""),
      cleanedText: typeof e.cleanedText === "string"
        ? e.cleanedText
        : (typeof e.formattedText === "string"
          ? e.formattedText
          : (typeof e.rawText === "string" ? e.rawText : "")),
      durationSeconds: typeof e.durationSeconds === "number" ? e.durationSeconds : 0,
      appBundleId: typeof e.appBundleId === "string" ? e.appBundleId : null,
      appName: typeof e.appName === "string" ? e.appName : null,
      injectionStatus: e.injectionStatus === "injected" ? "injected" : "saved",
      injectionMethod: e.injectionMethod === "clipboard" || e.injectionMethod === "ax" ? e.injectionMethod : null,
      language: typeof e.language === "string" ? e.language : null
    }));
}
