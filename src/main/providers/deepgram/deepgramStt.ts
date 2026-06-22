import type { TranscriptionResult } from "@shared/types";
import type { TranscriptionProvider } from "../types";
import { normalizeDeepgramLanguage, resolveReportedLanguage } from "@main/providers/language";
import { validateBearerEndpoint } from "../validation";
import { createWavBuffer, fetchWithTimeout } from "@main/providers/shared/audioUtils";

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
    const language = normalizeDeepgramLanguage(options.language);
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
    });

    if (!response.ok) {
      throw new Error(`Deepgram API is temporarily unavailable. Please try again.`);
    }

    const data = await response.json() as {
      results?: {
        channels?: {
          alternatives?: { transcript: string }[];
          detected_language?: string;
        }[];
      };
    };

    const rawText = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
    if (!rawText) throw new Error("No speech detected.");
    const detectedLanguage = data.results?.channels?.[0]?.detected_language ?? null;
    return {
      rawText,
      formattedText: rawText,
      language: resolveReportedLanguage(options.language),
      detectedLanguage,
    };
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async validateApiKey(apiKey): Promise<{ valid: boolean; message: string }> {
    return validateBearerEndpoint("Deepgram", "https://api.deepgram.com/v1/projects", apiKey, "Token");
  },
};
