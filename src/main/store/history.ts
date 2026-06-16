import { app } from "electron";
import { join } from "node:path";
import { APP_DATA_DIR, HISTORY_LIMIT } from "@shared/defaults";
import type { DictationEntry } from "@shared/types";
import { readJsonFile, writeJsonFile } from "./base";

export class HistoryStore {
  private readonly filePath: string;
  private pendingMutation: Promise<void> = Promise.resolve();
  private cache: DictationEntry[] | null = null;

  constructor(filePath = join(app.getPath("home"), APP_DATA_DIR, "history.json")) {
    this.filePath = filePath;
  }

  async getAll(): Promise<DictationEntry[]> {
    return [...await this.ensureLoaded()];
  }

  async append(entry: DictationEntry): Promise<void> {
    await this.enqueueMutation(async () => {
      const history = await this.ensureLoaded();
      const next = [entry, ...history].slice(0, HISTORY_LIMIT);
      await writeJsonFile(this.filePath, next);
      this.cache = next;
    });
  }

  async delete(id: string): Promise<void> {
    await this.enqueueMutation(async () => {
      const history = await this.ensureLoaded();
      const next = history.filter(e => e.id !== id);
      await writeJsonFile(this.filePath, next);
      this.cache = next;
    });
  }

  async clear(): Promise<void> {
    await this.enqueueMutation(async () => {
      await writeJsonFile(this.filePath, []);
      this.cache = [];
    });
  }

  async getById(id: string): Promise<DictationEntry | undefined> {
    const history = await this.ensureLoaded();
    return history.find(e => e.id === id);
  }

  async getLatest(): Promise<DictationEntry | undefined> {
    const history = await this.ensureLoaded();
    return history[0];
  }

  async updateById(id: string, updater: (entry: DictationEntry) => DictationEntry): Promise<DictationEntry | undefined> {
    let updatedEntry: DictationEntry | undefined;
    await this.enqueueMutation(async () => {
      const history = await this.ensureLoaded();

      const next = history.map((entry) => {
        if (entry.id !== id) {
          return entry;
        }

        updatedEntry = updater(entry);
        return updatedEntry;
      });

      if (!updatedEntry) {
        return;
      }

      await writeJsonFile(this.filePath, next);
      this.cache = next;
    });
    return updatedEntry;
  }

  private async ensureLoaded(): Promise<DictationEntry[]> {
    if (this.cache) {
      return this.cache;
    }
    const raw = await readJsonFile<unknown>(this.filePath, []);
    this.cache = normalizeHistory(raw);
    return this.cache;
  }

  private enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const run = this.pendingMutation.catch(() => undefined).then(operation);
    this.pendingMutation = run.catch(() => undefined);
    return run;
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
