import type { TranscriptionResult } from "@shared/types";
import type { TranscriptionProvider } from "../types";
import { resolveLanguageForProvider, resolveReportedLanguage } from "@main/providers/language";
import { validateBearerEndpoint } from "../validation";
import { createWavBuffer, fetchWithTimeout } from "@main/providers/shared/audioUtils";
import { throwIfAborted } from "@main/cancellation";

export const DeepgramSttProvider: TranscriptionProvider = {
  id: "deepgram",
  name: "Deepgram",
  requiresApiKey: true,
  models: [
    { id: "nova-2", name: "Nova 2" },
    { id: "nova-3", name: "Nova 3" },
  ],

  async transcribe(clip, options): Promise<TranscriptionResult> {
    if (!options.apiKey) throw new Error("Deepgram API key not configured. Go to Settings → API & Providers.");

    const wavBuffer = createWavBuffer(clip);
    const model = options.model || "nova-3";
    let url = `https://api.deepgram.com/v1/listen?model=${model}`;
    const language = resolveLanguageForProvider(options.language, "deepgram", model);
    if (language) {
      url += `&language=${encodeURIComponent(language)}`;
    } else {
      url += "&detect_language=true";
    }

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${options.apiKey}`,
        "Content-Type": "audio/wav",
      },
      body: new Uint8Array(wavBuffer),
      signal: options.signal,
    });
    throwIfAborted(options.signal);

    if (!response.ok) throw new Error(`Deepgram API request failed with status ${response.status}.`);

    const data = await response.json() as {
      results?: {
        channels?: {
          alternatives?: { transcript: string; confidence?: number }[];
          detected_language?: string;
        }[];
      };
    };
    throwIfAborted(options.signal);

    const alternative = data.results?.channels?.[0]?.alternatives?.[0];
    const rawText = alternative?.transcript?.trim() ?? "";
    if (!rawText) throw new Error("No speech detected.");
    const detectedLanguage = data.results?.channels?.[0]?.detected_language ?? null;
    return {
      rawText,
      formattedText: rawText,
      language: resolveReportedLanguage(options.language),
      detectedLanguage,
      quality: {
        provider: "deepgram",
        attemptCount: 1,
        supportsConfidence: true,
        confidence: typeof alternative?.confidence === "number" ? alternative.confidence : null,
        transcriptLength: rawText.length,
      },
    };
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async validateApiKey(apiKey): Promise<{ valid: boolean; message: string }> {
    return validateBearerEndpoint("Deepgram", "https://api.deepgram.com/v1/projects", apiKey, "Token");
  },
};
