import { app } from "electron";
import { join } from "node:path";
import { APP_DATA_DIR, DEFAULT_SETTINGS } from "@shared/defaults";
import type { Settings } from "@shared/types";
import { error } from "@main/log";
import { readJsonFile, writeJsonFile } from "./base";

type StoredSettings = Partial<Settings> & {
  nativeCaptureOptIn?: boolean;
  preWarmMicOptIn?: boolean;
};

const LEGACY_DEFAULT_FILLER_WORDS = [
  "um", "uh", "like", "basically", "you know", "sort of", "kind of", "actually", "literally",
];

// Fillers that shipped as defaults in old versions but delete real words far
// too often ("like", "kind of"...). Pruned from stored lists unless the user
// has explicitly edited their filler list since the flag was introduced.
const LEGACY_AGGRESSIVE_FILLERS = new Set(
  LEGACY_DEFAULT_FILLER_WORDS.filter((word) => word !== "um" && word !== "uh"),
);

export function pruneLegacyFillerWords(fillerWords: unknown, customized: boolean | undefined): string[] | null {
  if (customized || !Array.isArray(fillerWords)) return null;
  const pruned = fillerWords
    .filter((word): word is string => typeof word === "string")
    .filter((word) => !LEGACY_AGGRESSIVE_FILLERS.has(word.toLowerCase().trim()));
  return pruned.length === fillerWords.length ? null : pruned;
}

export class SettingsStore {
  private cached: Settings | null = null;
  private readonly filePath: string;
  private pendingWrite: Promise<void> = Promise.resolve();
  private nativeCaptureOptedIn = false;
  private preWarmMicOptedIn = false;

  constructor(filePath = join(app.getPath("home"), APP_DATA_DIR, "settings.json")) {
    this.filePath = filePath;
  }

  get(): Settings {
    if (this.cached) return this.cached;
    return { ...DEFAULT_SETTINGS };
  }

  private async load(): Promise<Settings> {
    const stored = await readJsonFile<StoredSettings>(this.filePath, {});
    const migrated = await this.migrateSettings(stored);
    this.nativeCaptureOptedIn = migrated.nativeCaptureOptIn === true;
    this.preWarmMicOptedIn = migrated.preWarmMicOptIn === true;
    const publicSettings = { ...migrated };
    delete publicSettings.nativeCaptureOptIn;
    delete publicSettings.preWarmMicOptIn;
    this.cached = { ...DEFAULT_SETTINGS, ...publicSettings, theme: "aurora" };
    return this.cached;
  }

  private async migrateSettings(stored: StoredSettings): Promise<StoredSettings> {
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

    const prunedFillers = pruneLegacyFillerWords(next.fillerWords, next.fillerWordsCustomized);
    if (prunedFillers) {
      next.fillerWords = prunedFillers;
      changed = true;
    }

    if (next.captureBackend === "native" && next.nativeCaptureOptIn !== true) {
      next.captureBackend = DEFAULT_SETTINGS.captureBackend;
      changed = true;
    }

    if (next.preWarmMic === true && next.preWarmMicOptIn !== true) {
      next.preWarmMic = DEFAULT_SETTINGS.preWarmMic;
      changed = true;
    }

    if (changed) {
      await writeJsonFile(this.filePath, next);
    }
    return next;
  }

  update(patch: Partial<Settings>): Settings {
    const next: Settings = { ...this.get(), ...patch, theme: "aurora" };
    if (patch.fillerWords !== undefined || patch.extraFillerWords !== undefined) {
      next.fillerWordsCustomized = true;
    }
    this.cached = next;
    const persisted: StoredSettings = { ...next };
    if (patch.captureBackend === "native") {
      this.nativeCaptureOptedIn = true;
    } else if (patch.captureBackend === "renderer") {
      this.nativeCaptureOptedIn = false;
    }
    if (this.nativeCaptureOptedIn && persisted.captureBackend === "native") {
      persisted.nativeCaptureOptIn = true;
    }
    if (patch.preWarmMic === true) {
      this.preWarmMicOptedIn = true;
    } else if (patch.preWarmMic === false) {
      this.preWarmMicOptedIn = false;
    }
    if (this.preWarmMicOptedIn && persisted.preWarmMic === true) {
      persisted.preWarmMicOptIn = true;
    }
    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(() => writeJsonFile(this.filePath, persisted))
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
