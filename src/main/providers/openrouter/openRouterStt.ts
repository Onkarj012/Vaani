import type { TranscriptionResult } from "@shared/types";
import type { TranscriptionProvider } from "../types";
import { normalizeWhisperLanguage, resolveReportedLanguage } from "@main/providers/language";
import { createWavBuffer } from "@main/providers/shared/audioUtils";
import { defaultModelFor, modelEntries, providerModels } from "@shared/modelList";
import { openRouterPostJson, validateOpenRouterKey } from "./client";

interface TranscriptionReply {
  text?: string;
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

export const OpenRouterSttProvider: TranscriptionProvider = {
  id: "openrouter",
  name: "OpenRouter",
  requiresApiKey: true,
  models: providerModels("transcription", "openrouter"),

  // Transcribes one clip through OpenRouter's audio transcriptions endpoint.
  async transcribe(clip, options): Promise<TranscriptionResult> {
    if (!options.apiKey) throw new Error("OpenRouter API key not configured. Go to Settings → API & Providers.");

    const model = options.model || defaultModelFor("transcription", "openrouter");
    const hints = hintProviderOptions(model, options.vocabularyHints ?? []);
    const language = normalizeWhisperLanguage(options.language);
    const reply = await openRouterPostJson<TranscriptionReply>({
      path: "/audio/transcriptions",
      apiKey: options.apiKey,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input_audio: { data: createWavBuffer(clip).toString("base64"), format: "wav" },
        ...(language ? { language } : {}),
        temperature: options.temperature ?? 0,
        ...(hints ? { provider: { options: hints } } : {}),
      }),
      signal: options.signal,
    });

    const rawText = (reply.text ?? "").trim();
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
        vocabularyHintsSent: hints !== null,
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
