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
  // Onboarding tracking
  dictionaryOnboarded: false,
  snippetsOnboarded: false,
};

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
}

export const KNOWN_PROVIDERS: ProviderInfo[] = [
  {
    id: "groq", name: "Groq Whisper", type: "stt",
    models: [{ id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo" }],
    requiresApiKey: true, defaultModel: "whisper-large-v3-turbo",
  },
  {
    id: "openai", name: "OpenAI Whisper", type: "stt",
    models: [{ id: "whisper-1", name: "Whisper v1" }],
    requiresApiKey: true, defaultModel: "whisper-1",
  },
  {
    id: "deepgram", name: "Deepgram", type: "stt",
    models: [
      { id: "nova-2", name: "Nova 2" },
      { id: "nova-3", name: "Nova 3" },
    ],
    requiresApiKey: true, defaultModel: "nova-3",
  },
  {
    id: "openai-compatible", name: "OpenAI Compatible", type: "stt",
    models: [{ id: "whisper-1", name: "Whisper v1 (compatible)" }],
    requiresApiKey: true, defaultModel: "whisper-1",
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
  },
  {
    id: "groq-llm", name: "Groq Llama", type: "llm",
    models: [
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
    ],
    requiresApiKey: true, defaultModel: "llama-3.1-8b-instant",
  },
  {
    id: "openai-llm", name: "OpenAI GPT", type: "llm",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4o", name: "GPT-4o" },
    ],
    requiresApiKey: true, defaultModel: "gpt-4o-mini",
  },
  {
    id: "anthropic", name: "Anthropic Claude", type: "llm",
    models: [
      { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku" },
      { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet" },
    ],
    requiresApiKey: true, defaultModel: "claude-3-5-haiku-latest",
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
  },
];
