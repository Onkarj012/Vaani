import type { TranscriptionResult } from "@shared/types";
import type { TranscriptionProvider } from "../types";
import { resolveReportedLanguage } from "../language";

/**
 * Local Whisper provider using the native whisper.cpp addon.
 * Falls back gracefully if the native module is not available.
 * Audio is processed entirely on-device — no internet required.
 */

let whisperModule: {
  whisperLoadModel?: (path: string) => boolean;
  whisperTranscribe?: (pcmData: Float32Array, sampleRate: number) => string;
  whisperIsModelLoaded?: () => boolean;
  whisperFreeModel?: () => void;
  whisperListModels?: (dir: string) => string[];
} | null = null;

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
    const mod = getWhisperModule();
    if (!mod?.whisperTranscribe) {
      throw new Error("Local Whisper is not available. Go to Settings → Offline Mode to configure.");
    }

    if (!mod.whisperIsModelLoaded?.()) {
      throw new Error("No Whisper model loaded. Go to Settings → Offline Mode to download a model.");
    }

    const pcmData = new Float32Array(clip.pcmData);
    const result = mod.whisperTranscribe(pcmData, clip.sampleRate);
    if (!result?.trim()) throw new Error("No speech detected.");
    return { rawText: result.trim(), formattedText: result.trim(), language: resolveReportedLanguage(options.language) };
  },

  async isAvailable(): Promise<boolean> {
    const mod = getWhisperModule();
    return !!(mod?.whisperTranscribe);
  },
};

export function loadWhisperModel(modelPath: string): boolean {
  const mod = getWhisperModule();
  if (!mod?.whisperLoadModel) return false;
  return mod.whisperLoadModel(modelPath);
}

export function isModelLoaded(): boolean {
  const mod = getWhisperModule();
  return mod?.whisperIsModelLoaded?.() ?? false;
}

export function freeWhisperModel(): void {
  const mod = getWhisperModule();
  mod?.whisperFreeModel?.();
}

export function listDownloadedModels(modelsDir: string): string[] {
  const mod = getWhisperModule();
  if (!mod?.whisperListModels) return [];
  return mod.whisperListModels(modelsDir);
}
