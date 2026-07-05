import Groq from "groq-sdk";
import type { TranscriptionResult } from "@shared/types";
import type { TranscriptionProvider } from "../types";
import { debug, error } from "@main/log";
import { buildTranscriptionPrompt, normalizeWhisperLanguage, resolveReportedLanguage } from "@main/providers/language";
import { validateBearerEndpoint } from "../validation";
import { createWavBuffer } from "@main/providers/shared/audioUtils";

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const ATTEMPT_TIMEOUT_MS = 15_000;

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export const GroqSttProvider: TranscriptionProvider = {
  id: "groq",
  name: "Groq Whisper",
  requiresApiKey: true,
  models: [{ id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo" }],

  async transcribe(clip, options): Promise<TranscriptionResult> {
    debug("groq", `transcribe called: hasApiKey=${!!options.apiKey}, clipDuration=${clip.durationSeconds.toFixed(2)}s, samples=${clip.pcmData.length}`);

    if (!options.apiKey) {
      error("groq", "No API key provided");
      throw new Error("Groq API key not configured. Go to Settings → API & Providers and enter your Groq API key.");
    }

    const wavBuffer = createWavBuffer(clip);
    debug("groq", `WAV buffer created: ${wavBuffer.length} bytes`);

    const arrayBuffer = wavBuffer.buffer.slice(wavBuffer.byteOffset, wavBuffer.byteOffset + wavBuffer.byteLength) as ArrayBuffer;
    const file = new File([arrayBuffer], "recording.wav", { type: "audio/wav" });

    const whisperLang = normalizeWhisperLanguage(options.language);
    const prompt = buildTranscriptionPrompt(options.prompt);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        debug("groq", `Attempt ${attempt + 1}/${MAX_RETRIES}: calling Groq API...`);
        const controller = new AbortController();
        const attemptTimer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
        const groq = new Groq({ apiKey: options.apiKey });
        const response = await groq.audio.transcriptions.create({
          file,
          model: options.model || "whisper-large-v3-turbo",
          language: whisperLang,
          temperature: options.temperature ?? 0,
          response_format: "verbose_json",
          ...(prompt ? { prompt } : {}),
        }, { signal: controller.signal });
        clearTimeout(attemptTimer);

        const rawText = (response.text ?? "").trim();
        debug("groq", `Success: ${rawText.length} chars`);

        if (!rawText) throw new Error("No speech detected in the recording.");

        const verbose = response as unknown as {
          language?: string;
          segments?: Array<{ avg_logprob?: number; compression_ratio?: number; no_speech_prob?: number }>;
        };
        const detectedLanguage = verbose.language ?? null;
        const segments = verbose.segments ?? [];
        const avgLogprob = averageNumber(segments.map((segment) => segment.avg_logprob));
        const compressionRatio = averageNumber(segments.map((segment) => segment.compression_ratio));
        const noSpeechProbability = maxNumber(segments.map((segment) => segment.no_speech_prob));

        return {
          rawText,
          formattedText: rawText,
          language: resolveReportedLanguage(options.language),
          detectedLanguage: detectedLanguage || null,
          quality: {
            provider: "groq",
            attemptCount: attempt + 1,
            supportsConfidence: true,
            avgLogprob,
            compressionRatio,
            noSpeechProbability,
            segmentCount: segments.length,
            transcriptLength: rawText.length,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = err instanceof Error ? err : new Error(message);

        // Don't retry user-facing errors
        if (isNotRetryableError(message)) throw lastError;

        debug("groq", `Attempt ${attempt + 1} failed: ${lastError.message}`);
        if (attempt < MAX_RETRIES - 1) await delay(RETRY_DELAY);
      }
    }

    throw new Error(`Groq transcription is temporarily unavailable. Please try again.`);
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async validateApiKey(apiKey): Promise<{ valid: boolean; message: string }> {
    return validateBearerEndpoint("Groq", "https://api.groq.com/openai/v1/models", apiKey);
  },
};

function averageNumber(values: Array<number | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function maxNumber(values: Array<number | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finite.length === 0) return null;
  return Math.max(...finite);
}

function isNotRetryableError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("no speech") ||
    lower.includes("401") || lower.includes("403") ||
    lower.includes("unauthorized") || lower.includes("authentication") ||
    lower.includes("invalid api key") || lower.includes("incorrect api key");
}
