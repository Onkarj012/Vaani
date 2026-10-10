import type { AudioClip, TranscriptionResult } from "@shared/types";
import type { TranscriptionProvider } from "../types";
import { normalizeWhisperLanguage, resolveReportedLanguage } from "@main/providers/language";
import { createWavBuffer } from "@main/providers/shared/audioUtils";
import { defaultModelFor, modelEntries, providerModels } from "@shared/modelList";
import { openRouterPostJson, validateOpenRouterKey } from "./client";

interface TranscriptionReply {
  text?: string;
  usage?: { cost?: number };
}

interface HintOption {
  slug: string;
  key: string;
  /** True when the vendor takes a list of terms. False when it takes one comma-separated prompt. */
  asList: boolean;
}

// Where each hint-capable model takes its vocabulary. OpenRouter documents only groq.prompt.
// The other slugs and keys come from each vendor's API and are unconfirmed through OpenRouter.
const HINT_OPTIONS: Record<string, HintOption> = {
  "openai/gpt-transcribe": { slug: "openai", key: "prompt", asList: false },
  "google/gemini-3.5-transcribe": { slug: "google-ai-studio", key: "custom_vocabulary", asList: true },
  "elevenlabs/scribe-v2": { slug: "elevenlabs", key: "keyterms", asList: true },
  "mistralai/voxtral-mini-transcribe": { slug: "mistral", key: "context_bias", asList: true },
};

export interface OpenRouterTranscriptionRequest {
  clip: AudioClip;
  apiKey: string;
  model: string;
  language?: string;
  vocabularyHints?: string[];
  temperature?: number;
  signal?: AbortSignal;
}

export interface OpenRouterTranscriptionReply {
  /** Trimmed transcript. Empty when the model heard nothing. */
  text: string;
  /** True when the request body carried vocabulary hints. */
  hintsSent: boolean;
  /** The reply's usage object, when OpenRouter returns one. */
  usage?: { cost?: number };
}

// Sends one clip to OpenRouter's transcription endpoint. The app adapter and the A/B script both call this.
export async function transcribeWithOpenRouter(request: OpenRouterTranscriptionRequest): Promise<OpenRouterTranscriptionReply> {
  const hints = hintProviderOptions(request.model, request.vocabularyHints ?? []);
  const language = normalizeWhisperLanguage(request.language);
  const reply = await openRouterPostJson<TranscriptionReply>({
    path: "/audio/transcriptions",
    apiKey: request.apiKey,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: request.model,
      input_audio: { data: createWavBuffer(request.clip).toString("base64"), format: "wav" },
      ...(language ? { language } : {}),
      temperature: request.temperature ?? 0,
      ...(hints ? { provider: { options: hints } } : {}),
    }),
    signal: request.signal,
  });
  return { text: (reply.text ?? "").trim(), hintsSent: hints !== null, usage: reply.usage };
}

export const OpenRouterSttProvider: TranscriptionProvider = {
  id: "openrouter",
  name: "OpenRouter",
  requiresApiKey: true,
  models: providerModels("transcription", "openrouter"),

  // Transcribes one clip through OpenRouter's audio transcriptions endpoint.
  async transcribe(clip, options): Promise<TranscriptionResult> {
    if (!options.apiKey) throw new Error("OpenRouter API key not configured. Go to Settings → API & Providers.");

    const reply = await transcribeWithOpenRouter({
      clip,
      apiKey: options.apiKey,
      model: options.model || defaultModelFor("transcription", "openrouter"),
      language: options.language,
      vocabularyHints: options.vocabularyHints,
      temperature: options.temperature,
      signal: options.signal,
    });

    const rawText = reply.text;
    if (!rawText) throw new Error("No speech detected.");
    return {
      rawText,
      formattedText: rawText,
      language: resolveReportedLanguage(options.language),
      detectedLanguage: null,
      quality: {
        provider: "openrouter",
        attemptCount: 1,
        supportsConfidence: false,
        transcriptLength: rawText.length,
        vocabularyHintsSent: reply.hintsSent,
      },
    };
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async validateApiKey(apiKey): Promise<{ valid: boolean; message: string }> {
    return validateOpenRouterKey(apiKey);
  },
};

// Provider options that carry the hints, or null when the model takes none or there are no terms.
function hintProviderOptions(model: string, terms: string[]): Record<string, Record<string, string | string[]>> | null {
  const takesHints = modelEntries("transcription", "openrouter").some((entry) => entry.modelId === model && entry.acceptsVocabularyHints);
  const option = HINT_OPTIONS[model];
  if (!takesHints || !option || terms.length === 0) return null;
  return { [option.slug]: { [option.key]: option.asList ? terms : terms.join(", ") } };
}
