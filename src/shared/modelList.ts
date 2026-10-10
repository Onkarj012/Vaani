import type { AppProfile, Settings } from "./types";

// The only model list. Both pickers and every direct adapter's model list come from here.
// Prices come from docs/reliability-review/research.md (2026-10-09). Grok and MAI prices are not confirmed.

export type ModelRole = "transcription" | "cleanup";

export interface ModelPrice {
  /** "audio hour" for transcription, "1M tokens" for cleanup. */
  unit: "audio hour" | "1M tokens";
  /** USD per unit. Null when the price is not confirmed. For token pricing, the input price. */
  amount: number | null;
  /** USD per 1M output tokens. Token pricing only. */
  outputAmount?: number;
}

export interface ModelEntry {
  role: ModelRole;
  /** Provider ID, as used in KNOWN_PROVIDERS and the adapter registry. */
  provider: string;
  modelId: string;
  displayName: string;
  price: ModelPrice;
  acceptsVocabularyHints: boolean;
  isReasoning: boolean;
  /** Kept for saved settings and fallback only. Not offered as a new choice. */
  isHiddenFallback: boolean;
}

export const MODEL_ENTRIES: readonly ModelEntry[] = [
  {
    role: "transcription", provider: "openrouter", modelId: "openai/gpt-transcribe", displayName: "GPT Transcribe",
    price: { unit: "audio hour", amount: 0.27 }, acceptsVocabularyHints: true, isReasoning: false, isHiddenFallback: false,
  },
  {
    role: "transcription", provider: "openrouter", modelId: "google/gemini-3.5-transcribe", displayName: "Gemini 3.5 Transcribe",
    price: { unit: "audio hour", amount: 0.3 }, acceptsVocabularyHints: true, isReasoning: false, isHiddenFallback: false,
  },
  {
    role: "transcription", provider: "openrouter", modelId: "x-ai/grok-stt-1.0", displayName: "Grok STT 1.0",
    price: { unit: "audio hour", amount: null }, acceptsVocabularyHints: false, isReasoning: false, isHiddenFallback: false,
  },
  {
    role: "transcription", provider: "openrouter", modelId: "elevenlabs/scribe-v2", displayName: "Scribe v2",
    price: { unit: "audio hour", amount: 0.22 }, acceptsVocabularyHints: true, isReasoning: false, isHiddenFallback: false,
  },
  {
    role: "transcription", provider: "openrouter", modelId: "mistralai/voxtral-mini-transcribe", displayName: "Voxtral Mini Transcribe",
    price: { unit: "audio hour", amount: 0.18 }, acceptsVocabularyHints: true, isReasoning: false, isHiddenFallback: false,
  },
  {
    role: "transcription", provider: "openrouter", modelId: "microsoft/mai-transcribe-2", displayName: "MAI Transcribe 2",
    price: { unit: "audio hour", amount: null }, acceptsVocabularyHints: false, isReasoning: false, isHiddenFallback: false,
  },
  {
    role: "transcription", provider: "groq", modelId: "whisper-large-v3-turbo", displayName: "Whisper Large v3 Turbo",
    price: { unit: "audio hour", amount: 0.04 }, acceptsVocabularyHints: true, isReasoning: false, isHiddenFallback: true,
  },
  {
    role: "cleanup", provider: "openrouter", modelId: "anthropic/claude-haiku-5.5", displayName: "Claude Haiku 5.5",
    price: { unit: "1M tokens", amount: 0.1, outputAmount: 0.5 }, acceptsVocabularyHints: false, isReasoning: false, isHiddenFallback: false,
  },
  {
    role: "cleanup", provider: "openrouter", modelId: "openai/gpt-6-luna", displayName: "GPT-6 Luna",
    price: { unit: "1M tokens", amount: 0.05, outputAmount: 0.25 }, acceptsVocabularyHints: false, isReasoning: false, isHiddenFallback: false,
  },
  {
    role: "cleanup", provider: "groq-llm", modelId: "openai/gpt-oss-20b", displayName: "GPT-OSS 20B",
    price: { unit: "1M tokens", amount: 0.075, outputAmount: 0.3 }, acceptsVocabularyHints: false, isReasoning: true, isHiddenFallback: false,
  },
  {
    role: "cleanup", provider: "groq-llm", modelId: "openai/gpt-oss-120b", displayName: "GPT-OSS 120B",
    price: { unit: "1M tokens", amount: 0.15, outputAmount: 0.6 }, acceptsVocabularyHints: false, isReasoning: true, isHiddenFallback: false,
  },
  {
    role: "cleanup", provider: "openai-llm", modelId: "gpt-6-luna", displayName: "GPT-6 Luna",
    price: { unit: "1M tokens", amount: 0.05, outputAmount: 0.25 }, acceptsVocabularyHints: false, isReasoning: false, isHiddenFallback: false,
  },
  {
    role: "cleanup", provider: "anthropic", modelId: "claude-haiku-5-5", displayName: "Claude Haiku 5.5",
    price: { unit: "1M tokens", amount: 0.1, outputAmount: 0.5 }, acceptsVocabularyHints: false, isReasoning: false, isHiddenFallback: false,
  },
];

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 3 });

/** Listed entries for a role, optionally limited to one provider. */
export function modelEntries(role: ModelRole, provider?: string): ModelEntry[] {
  return MODEL_ENTRIES.filter((entry) => entry.role === role && (provider === undefined || entry.provider === provider));
}

/** Entries the Settings picker offers for a role. Hidden fallbacks are left out. */
export function pickerEntries(role: ModelRole): ModelEntry[] {
  return modelEntries(role).filter((entry) => !entry.isHiddenFallback);
}

/** Adapter model list (`{ id, name }`) for one provider and role. */
export function providerModels(role: ModelRole, provider: string): { id: string; name: string }[] {
  return modelEntries(role, provider).map((entry) => ({ id: entry.modelId, name: entry.displayName }));
}

/** Keeps the model when the provider lists it, or when the provider has no list. Otherwise returns the provider's default. */
export function modelForProvider(role: ModelRole, provider: string, modelId: string): string {
  const entries = modelEntries(role, provider);
  if (entries.length === 0) return modelId;
  return entries.some((entry) => entry.modelId === modelId) ? modelId : defaultModelFor(role, provider);
}

/** A provider's default model: its first listed entry, or "" when it has no list. */
export function defaultModelFor(role: ModelRole, provider: string): string {
  return modelEntries(role, provider)[0]?.modelId ?? "";
}

/** Picker value for a provider and model pair. Unique because IDs never contain "|". */
export function modelOptionValue(provider: string, modelId: string): string {
  return `${provider}|${modelId}`;
}

/** Price text for a picker label. */
export function formatModelPrice(price: ModelPrice): string {
  if (price.amount === null) return "price not confirmed";
  if (price.unit === "audio hour") return `${USD.format(price.amount)} / audio hour`;
  const output = price.outputAmount === undefined ? "" : ` · ${USD.format(price.outputAmount)} out`;
  return `${USD.format(price.amount)} in${output} / 1M tokens`;
}

export type SessionModelFields = Pick<Settings, "transcriptionProvider" | "transcriptionModel" | "formattingProvider" | "formattingModel">;

/** Provider and model for one session. A profile's provider override gets a model of that provider, never the global one. */
export function resolveSessionModels(settings: SessionModelFields, profile: AppProfile | null | undefined): SessionModelFields {
  const transcriptionProvider = profile?.transcriptionProvider ?? settings.transcriptionProvider;
  const formattingProvider = profile?.formattingProvider ?? settings.formattingProvider;
  return {
    transcriptionProvider,
    transcriptionModel: pairedModel("transcription", transcriptionProvider, settings.transcriptionProvider, settings.transcriptionModel),
    formattingProvider,
    formattingModel: pairedModel("cleanup", formattingProvider, settings.formattingProvider, settings.formattingModel),
  };
}

// The global model belongs to the global provider only. Any other provider gets its own default.
function pairedModel(role: ModelRole, provider: string, globalProvider: string, globalModel: string): string {
  return provider === globalProvider ? modelForProvider(role, provider, globalModel) : defaultModelFor(role, provider);
}
