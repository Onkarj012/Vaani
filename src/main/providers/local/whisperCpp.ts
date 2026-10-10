import type { TranscriptionResult } from "@shared/types";
import type { TranscriptionProvider } from "../types";
import { resolveReportedLanguage } from "@main/providers/language";
import { throwIfAborted } from "@main/cancellation";
import { assertValidWhisperModelName } from "@shared/whisperModels";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/**
 * Local Whisper provider using the native whisper.cpp addon.
 * Falls back gracefully if the native module is not available.
 * Audio is processed entirely on-device — no internet required.
 */

interface WhisperModule {
  whisperLoadModel?: (path: string) => boolean;
  whisperTranscribe?: (pcmData: Float32Array, sampleRate: number) => string;
  whisperIsModelLoaded?: () => boolean;
  whisperFreeModel?: () => void;
  whisperListModels?: (dir: string) => string[];
}
let whisperModule: WhisperModule | null = null;
let loadedModelName: string | null = null;

export function ensureWhisperModel(mod: WhisperModule, modelName: string): void {
  assertValidWhisperModelName(modelName);
  if (loadedModelName === modelName && mod.whisperIsModelLoaded?.()) return;
  const modelPath = join(homedir(), ".vaani", "models", `ggml-${modelName}.bin`);
  if (!mod.whisperLoadModel?.(modelPath)) throw new Error(`Local Whisper model "${modelName}" could not be loaded.`);
  loadedModelName = modelName;
}

function getWhisperModule() {
  if (whisperModule) return whisperModule;

  try {
    whisperModule = require("../../../../build/Release/vaani_native.node") || {};
    if (!whisperModule?.whisperTranscribe) {
      whisperModule = null;
    }
  } catch {
    whisperModule = null;
  }

  return whisperModule;
}

export const LocalWhisperProvider: TranscriptionProvider = {
  id: "local-whisper",
  name: "Local Whisper (Offline)",
  requiresApiKey: false,
  models: [
    { id: "tiny.en", name: "Tiny English (78 MB)" },
    { id: "base.en", name: "Base English (147 MB)" },
    { id: "small.en", name: "Small English (488 MB)" },
    { id: "medium.en", name: "Medium English (1.5 GB)" },
  ],

  async transcribe(clip, options): Promise<TranscriptionResult> {
    throwIfAborted(options.signal);
    const mod = getWhisperModule();
    if (!mod?.whisperTranscribe) {
      throw new Error("Local Whisper is not available. Go to Settings → Offline Mode to configure.");
    }

    if (options.model) {
      ensureWhisperModel(mod, options.model);
    }

    if (!mod.whisperIsModelLoaded?.()) {
      throw new Error("No Whisper model loaded. Go to Settings → Offline Mode to download a model.");
    }

    const pcmData = new Float32Array(clip.pcmData);
    const result = mod.whisperTranscribe(pcmData, clip.sampleRate);
    throwIfAborted(options.signal);
    if (!result?.trim()) throw new Error("No speech detected.");
    const rawText = result.trim();
    return {
      rawText,
      formattedText: rawText,
      language: resolveReportedLanguage(options.language),
      quality: {
        provider: "local-whisper",
        attemptCount: 1,
        supportsConfidence: false,
        transcriptLength: rawText.length,
      },
    };
  },

  async isAvailable(): Promise<boolean> {
    const mod = getWhisperModule();
    return !!(mod?.whisperTranscribe && mod.whisperIsModelLoaded?.());
  },
};

export function loadWhisperModel(modelPath: string): boolean {
  const mod = getWhisperModule();
  if (!mod?.whisperLoadModel) return false;
  const loaded = mod.whisperLoadModel(modelPath);
  if (loaded) {
    const match = /^ggml-(.+)\.bin$/.exec(basename(modelPath));
    loadedModelName = match?.[1] ?? null;
  }
  return loaded;
}

export function isModelLoaded(): boolean {
  const mod = getWhisperModule();
  return mod?.whisperIsModelLoaded?.() ?? false;
}

export function freeWhisperModel(): void {
  const mod = getWhisperModule();
  mod?.whisperFreeModel?.();
  loadedModelName = null;
}

export function listDownloadedModels(modelsDir: string): string[] {
  const mod = getWhisperModule();
  if (!mod?.whisperListModels) return [];
  return mod.whisperListModels(modelsDir);
}
