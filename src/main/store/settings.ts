import { app } from "electron";
import { join } from "node:path";
import { APP_DATA_DIR, DEFAULT_SETTINGS } from "@shared/defaults";
import type { Settings } from "@shared/types";
import { error } from "@main/log";
import { readJsonFile, writeJsonFile } from "./base";

const LEGACY_DEFAULT_FILLER_WORDS = [
  "um", "uh", "like", "basically", "you know", "sort of", "kind of", "actually", "literally",
];

export class SettingsStore {
  private cached: Settings | null = null;
  private readonly filePath: string;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(filePath = join(app.getPath("home"), APP_DATA_DIR, "settings.json")) {
    this.filePath = filePath;
  }

  get(): Settings {
    if (this.cached) return this.cached;
    return { ...DEFAULT_SETTINGS };
  }

  private async load(): Promise<Settings> {
    const stored = await readJsonFile<Partial<Settings>>(this.filePath, {});
    const migrated = await this.migrateSettings(stored);
    this.cached = { ...DEFAULT_SETTINGS, ...migrated, theme: "aurora" };
    return this.cached;
  }

  private async migrateSettings(stored: Partial<Settings>): Promise<Partial<Settings>> {
    let changed = false;
    const next = { ...stored };

    // silenceThreshold 0.02 → 0.005 (pre-v1.0.4 users had broken audio)
    if (next.silenceThreshold !== undefined && next.silenceThreshold > 0.01 && next.silenceThreshold <= 0.025) {
      next.silenceThreshold = DEFAULT_SETTINGS.silenceThreshold;
      changed = true;
    }

    if (arraysEqual(next.fillerWords, LEGACY_DEFAULT_FILLER_WORDS)) {
      next.fillerWords = DEFAULT_SETTINGS.fillerWords;
      next.extraFillerWords = DEFAULT_SETTINGS.extraFillerWords;
      changed = true;
    }

    if (changed) {
      await writeJsonFile(this.filePath, next);
    }
    return next;
  }

  update(patch: Partial<Settings>): Settings {
    const next: Settings = { ...this.get(), ...patch, theme: "aurora" };
    this.cached = next;
    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(() => writeJsonFile(this.filePath, next))
      .catch((err) => {
        error("settings", `Failed to persist settings to ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`);
      });
    return next;
  }

  async init(): Promise<void> {
    await this.load();
  }
}

function arraysEqual(left: unknown, right: string[]): left is string[] {
  return Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
