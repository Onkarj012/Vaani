import { app } from "electron";
import { join } from "node:path";
import { APP_DATA_DIR, DEFAULT_SETTINGS } from "@shared/defaults";
import type { Settings } from "@shared/types";
import { readJsonFile, writeJsonFile } from "./base";

export class SettingsStore {
  private cached: Settings | null = null;
  private readonly filePath: string;

  constructor(filePath = join(app.getPath("home"), APP_DATA_DIR, "settings.json")) {
    this.filePath = filePath;
  }

  get(): Settings {
    if (this.cached) return this.cached;
    return { ...DEFAULT_SETTINGS };
  }

  private async load(): Promise<Settings> {
    const stored = await readJsonFile<Partial<Settings>>(this.filePath, {});
    const migrated = this.migrateSettings(stored);
    this.cached = { ...DEFAULT_SETTINGS, ...migrated, theme: "aurora" };
    return this.cached;
  }

  private migrateSettings(stored: Partial<Settings>): Partial<Settings> {
    let changed = false;
    const next = { ...stored };

    // silenceThreshold 0.02 → 0.005 (pre-v1.0.4 users had broken audio)
    if (next.silenceThreshold !== undefined && next.silenceThreshold > 0.01 && next.silenceThreshold <= 0.025) {
      next.silenceThreshold = DEFAULT_SETTINGS.silenceThreshold;
      changed = true;
    }

    if (changed) {
      void writeJsonFile(this.filePath, next);
    }
    return next;
  }

  update(patch: Partial<Settings>): Settings {
    const next: Settings = { ...this.get(), ...patch, theme: "aurora" };
    this.cached = next;
    void writeJsonFile(this.filePath, next);
    return next;
  }

  async init(): Promise<void> {
    await this.load();
  }
}
