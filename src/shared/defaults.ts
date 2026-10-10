import type { Settings } from "./types";
import { defaultModelFor } from "./modelList";

export const DEFAULT_FILLER_WORDS = [
  "um", "uh"
];

export const DEFAULT_SETTINGS: Settings = {
  onboardingCompleted: false,
  groqApiKey: "",
  primaryHotkey: "Fn",
  pasteLatestHotkey: "Ctrl+Cmd+V",
  language: "auto",
  customPrompt: "",
  cleanupEnabled: true,
  smartPunctuation: true,
  fillerWords: DEFAULT_FILLER_WORDS,
  extraFillerWords: [],
  customCorrections: [],
  snippets: [],
  injectionMode: "auto",
  pasteMode: "animated",
  theme: "aurora",
  colorMode: "dark",
  accentColor: "#7C3AED",
  launchAtLogin: false,
  showInDock: true,
  minClipDuration: 0.5,
  silenceThreshold: 0.005,
  capsuleBorderWidth: 1,
  capsuleBarRadius: 2,
  capsuleCornerRadius: 20,
  capsuleDesign: "pill",
  // Phase 0
  dictationMode: "toggle",
  saveRecordings: false,
  recordingsPath: "",
  recoveryRetentionDays: 3,
  retainFailedAudio: false,
  // Phase 1
  transcriptionProvider: "openrouter",
  transcriptionModel: defaultModelFor("transcription", "openrouter"),
  formattingProvider: "openrouter",
  formattingModel: defaultModelFor("cleanup", "openrouter"),
  providerApiKeys: [],
  failoverEnabled: true,
  openRouterKeyPromptShown: false,
  // Phase 2
  localWhisperModel: "tiny.en",
  offlineMode: "auto",
  contextAwarenessEnabled: false,
  micDeviceId: undefined,
  preWarmMic: false,
  captureBackend: "renderer",
  captureProcessing: "default",
  stylePreset: "plain",
  // Onboarding tracking
  dictionaryOnboarded: false,
  snippetsOnboarded: false,
  setupChecklistDismissed: false,
  // Per-app overrides
  appProfiles: [],
};

// ─── Language metadata (shared by main provider chain + renderer UI) ─────────

export interface LanguageInfo {
  value: string;
  label: string;
  // Whisper-style multilingual STT (Groq/OpenAI Whisper, multilingual local models).
  whisper: boolean;
  // Deepgram Nova language-code support.
  deepgram: boolean;
  // Supported by English-only local Whisper models (.en).
  localEn: boolean;
}

export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  { value: "auto", label: "Auto-detect", whisper: true, deepgram: true, localEn: true },
  { value: "en", label: "English", whisper: true, deepgram: true, localEn: true },
  { value: "hi", label: "Hindi", whisper: true, deepgram: true, localEn: false },
  { value: "hinglish", label: "Hinglish", whisper: true, deepgram: false, localEn: false },
  { value: "ta", label: "Tamil", whisper: true, deepgram: true, localEn: false },
  { value: "pa", label: "Punjabi", whisper: true, deepgram: false, localEn: false },
  { value: "mr", label: "Marathi", whisper: true, deepgram: false, localEn: false },
  { value: "bn", label: "Bengali", whisper: true, deepgram: false, localEn: false },
  { value: "gu", label: "Gujarati", whisper: true, deepgram: false, localEn: false },
  { value: "te", label: "Telugu", whisper: true, deepgram: false, localEn: false },
  { value: "kn", label: "Kannada", whisper: true, deepgram: false, localEn: false },
  { value: "ml", label: "Malayalam", whisper: true, deepgram: false, localEn: false },
  { value: "es", label: "Spanish", whisper: true, deepgram: true, localEn: false },
  { value: "fr", label: "French", whisper: true, deepgram: true, localEn: false },
  { value: "de", label: "German", whisper: true, deepgram: true, localEn: false },
  { value: "ja", label: "Japanese", whisper: true, deepgram: true, localEn: false },
  { value: "zh", label: "Chinese", whisper: true, deepgram: true, localEn: false },
  { value: "ko", label: "Korean", whisper: true, deepgram: true, localEn: false },
  { value: "ar", label: "Arabic", whisper: true, deepgram: true, localEn: false },
  { value: "pt", label: "Portuguese", whisper: true, deepgram: true, localEn: false },
  { value: "ru", label: "Russian", whisper: true, deepgram: true, localEn: false },
];

export function getLanguageLabel(language: string | null | undefined): string | null {
  if (!language) return null;
  return SUPPORTED_LANGUAGES.find((entry) => entry.value === language)?.label ?? language;
}

export function resolveProfileLanguage(profileLanguage: string | undefined, globalLanguage: string): string {
  return profileLanguage && profileLanguage !== "auto" ? profileLanguage : globalLanguage;
}

// Pure support check used by both the provider chain and the Settings UI.
export function isLanguageSupportedByProvider(
  language: string,
  providerId: string,
  modelId?: string,
): boolean {
  if (language === "auto") return true;
  const info = SUPPORTED_LANGUAGES.find((l) => l.value === language);
  if (!info) return false;
  if (providerId === "deepgram") return info.deepgram;
  if (providerId === "local-whisper") {
    const englishOnly = !modelId || modelId.endsWith(".en");
    return englishOnly ? info.localEn : info.whisper;
  }
  return info.whisper;
}

export const HISTORY_LIMIT = 2000;
export const SUCCESS_RESET_MS = 600;
export const ERROR_RESET_MS = 1_800;
export const HOTKEY_DOUBLE_PRESS_WINDOW_MS = 350;
export const APP_DATA_DIR = ".vaani";

// ─── Provider metadata ───────────────────────────────────────────────────────

export interface ProviderInfo {
  id: string;
  name: string;
  type: "stt" | "llm" | "local-stt";
  requiresApiKey: boolean;
  locality?: "cloud" | "local";
  estimatedCost?: "free-local" | "low" | "medium" | "varies";
  privacyLevel?: "local-only" | "cloud-audio" | "cloud-text";
  supportsConfidence?: boolean;
  latencyClass?: "fast" | "medium" | "slow";
  /** Code stays in the repo, but the option is not offered and saved settings move off it. */
  hidden?: boolean;
}

export const KNOWN_PROVIDERS: ProviderInfo[] = [
  {
    id: "groq", name: "Groq Whisper", type: "stt",
    requiresApiKey: true,
    locality: "cloud", estimatedCost: "low", privacyLevel: "cloud-audio", supportsConfidence: true, latencyClass: "fast",
  },
  {
    id: "openai", name: "OpenAI Whisper", type: "stt",
    requiresApiKey: true,
    locality: "cloud", estimatedCost: "medium", privacyLevel: "cloud-audio", supportsConfidence: true, latencyClass: "medium",
  },
  {
    id: "deepgram", name: "Deepgram", type: "stt",
    requiresApiKey: true,
    locality: "cloud", estimatedCost: "medium", privacyLevel: "cloud-audio", supportsConfidence: true, latencyClass: "fast",
  },
  {
    id: "openai-compatible", name: "OpenAI Compatible", type: "stt",
    requiresApiKey: true, hidden: true,
    locality: "cloud", estimatedCost: "varies", privacyLevel: "cloud-audio", supportsConfidence: false, latencyClass: "medium",
  },
  {
    id: "local-whisper", name: "Local Whisper (Offline)", type: "local-stt",
    requiresApiKey: false, hidden: true,
    locality: "local", estimatedCost: "free-local", privacyLevel: "local-only", supportsConfidence: false, latencyClass: "slow",
  },
  {
    id: "groq-llm", name: "Groq Llama", type: "llm",
    requiresApiKey: true,
    locality: "cloud", estimatedCost: "low", privacyLevel: "cloud-text", latencyClass: "fast",
  },
  {
    id: "openai-llm", name: "OpenAI GPT", type: "llm",
    requiresApiKey: true,
    locality: "cloud", estimatedCost: "medium", privacyLevel: "cloud-text", latencyClass: "medium",
  },
  {
    id: "anthropic", name: "Anthropic Claude", type: "llm",
    requiresApiKey: true,
    locality: "cloud", estimatedCost: "medium", privacyLevel: "cloud-text", latencyClass: "medium",
  },
  {
    id: "openrouter", name: "OpenRouter", type: "llm",
    requiresApiKey: true,
    locality: "cloud", estimatedCost: "varies", privacyLevel: "cloud-text", latencyClass: "medium",
  },
];

/** True for a provider flagged hidden. Hidden providers are never offered or used automatically. */
export function isHiddenProvider(providerId: string | undefined): boolean {
  return KNOWN_PROVIDERS.some((provider) => provider.id === providerId && provider.hidden === true);
}
