import type { Settings } from "./types";

export const DEFAULT_FILLER_WORDS = [
  "um", "uh", "like", "basically", "you know", "sort of", "kind of", "actually", "literally"
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
  // Phase 1
  transcriptionProvider: "groq",
  formattingProvider: "groq-llm",
  formattingModel: "llama-3.1-8b-instant",
  providerApiKeys: [],
  failoverEnabled: true,
  // Phase 2
  localWhisperModel: "tiny.en",
  offlineMode: "auto",
  contextAwarenessEnabled: false,
  micDeviceId: undefined,
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
  models: { id: string; name: string }[];
  requiresApiKey: boolean;
  defaultModel: string;
  locality?: "cloud" | "local";
  estimatedCost?: "free-local" | "low" | "medium" | "varies";
  privacyLevel?: "local-only" | "cloud-audio" | "cloud-text";
  supportsConfidence?: boolean;
  latencyClass?: "fast" | "medium" | "slow";
}

export const KNOWN_PROVIDERS: ProviderInfo[] = [
  {
    id: "groq", name: "Groq Whisper", type: "stt",
    models: [{ id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo" }],
    requiresApiKey: true, defaultModel: "whisper-large-v3-turbo",
    locality: "cloud", estimatedCost: "low", privacyLevel: "cloud-audio", supportsConfidence: true, latencyClass: "fast",
  },
  {
    id: "openai", name: "OpenAI Whisper", type: "stt",
    models: [{ id: "whisper-1", name: "Whisper v1" }],
    requiresApiKey: true, defaultModel: "whisper-1",
    locality: "cloud", estimatedCost: "medium", privacyLevel: "cloud-audio", supportsConfidence: true, latencyClass: "medium",
  },
  {
    id: "deepgram", name: "Deepgram", type: "stt",
    models: [
      { id: "nova-2", name: "Nova 2" },
      { id: "nova-3", name: "Nova 3" },
    ],
    requiresApiKey: true, defaultModel: "nova-3",
    locality: "cloud", estimatedCost: "medium", privacyLevel: "cloud-audio", supportsConfidence: true, latencyClass: "fast",
  },
  {
    id: "openai-compatible", name: "OpenAI Compatible", type: "stt",
    models: [{ id: "whisper-1", name: "Whisper v1 (compatible)" }],
    requiresApiKey: true, defaultModel: "whisper-1",
    locality: "cloud", estimatedCost: "varies", privacyLevel: "cloud-audio", supportsConfidence: false, latencyClass: "medium",
  },
  {
    id: "local-whisper", name: "Local Whisper (Offline)", type: "local-stt",
    models: [
      { id: "tiny.en", name: "Tiny English (78 MB)" },
      { id: "base.en", name: "Base English (147 MB)" },
      { id: "small.en", name: "Small English (488 MB)" },
      { id: "medium.en", name: "Medium English (1.5 GB)" },
    ],
    requiresApiKey: false, defaultModel: "tiny.en",
    locality: "local", estimatedCost: "free-local", privacyLevel: "local-only", supportsConfidence: false, latencyClass: "slow",
  },
  {
    id: "groq-llm", name: "Groq Llama", type: "llm",
    models: [
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
    ],
    requiresApiKey: true, defaultModel: "llama-3.1-8b-instant",
    locality: "cloud", estimatedCost: "low", privacyLevel: "cloud-text", latencyClass: "fast",
  },
  {
    id: "openai-llm", name: "OpenAI GPT", type: "llm",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4o", name: "GPT-4o" },
    ],
    requiresApiKey: true, defaultModel: "gpt-4o-mini",
    locality: "cloud", estimatedCost: "medium", privacyLevel: "cloud-text", latencyClass: "medium",
  },
  {
    id: "anthropic", name: "Anthropic Claude", type: "llm",
    models: [
      { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku" },
      { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet" },
    ],
    requiresApiKey: true, defaultModel: "claude-3-5-haiku-latest",
    locality: "cloud", estimatedCost: "medium", privacyLevel: "cloud-text", latencyClass: "medium",
  },
  {
    id: "openrouter", name: "OpenRouter", type: "llm",
    models: [
      { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku" },
      { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
      { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash" },
    ],
    requiresApiKey: true, defaultModel: "openai/gpt-4o-mini",
    locality: "cloud", estimatedCost: "varies", privacyLevel: "cloud-text", latencyClass: "medium",
  },
];
