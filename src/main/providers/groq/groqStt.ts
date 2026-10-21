import type { TranscriptionResult } from "@shared/types";
import type { TranscriptionProvider } from "../types";
import { debug, error } from "@main/log";
import { buildTranscriptionPrompt, normalizeWhisperLanguage, resolveReportedLanguage } from "@main/providers/language";
import { validateBearerEndpoint } from "../validation";
import { createWavBuffer } from "@main/providers/shared/audioUtils";
import { runWithDeadline } from "@main/cancellation";
import { defaultModelFor, providerModels } from "@shared/modelList";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const REQUEST_TIMEOUT_MS = 6_000;
const WARM_UP_TIMEOUT_MS = 3_000;

interface GroqVerboseReply {
  text?: string;
  language?: string;
  segments?: Array<{ avg_logprob?: number; compression_ratio?: number; no_speech_prob?: number }>;
}

export const GroqSttProvider: TranscriptionProvider = {
  id: "groq",
  name: "Groq Whisper",
  requiresApiKey: true,
  models: providerModels("transcription", "groq"),

  // Sends one clip to Groq's transcriptions endpoint. One request per call; the chain decides any retry.
  async transcribe(clip, options): Promise<TranscriptionResult> {
    debug("groq", `transcribe called: hasApiKey=${!!options.apiKey}, clipDuration=${clip.durationSeconds.toFixed(2)}s, samples=${clip.pcmData.length}`);

    if (!options.apiKey) {
      error("groq", "No API key provided");
      throw new Error("Groq API key not configured. Go to Settings → API & Providers and enter your Groq API key.");
    }

    const wavBuffer = createWavBuffer(clip);
    debug("groq", `WAV buffer created: ${wavBuffer.length} bytes`);

    const arrayBuffer = wavBuffer.buffer.slice(wavBuffer.byteOffset, wavBuffer.byteOffset + wavBuffer.byteLength) as ArrayBuffer;
    const form = new FormData();
    form.append("file", new File([arrayBuffer], "recording.wav", { type: "audio/wav" }));
    form.append("model", options.model || defaultModelFor("transcription", "groq"));
    const whisperLang = normalizeWhisperLanguage(options.language);
    if (whisperLang) form.append("language", whisperLang);
    form.append("temperature", String(options.temperature ?? 0));
    form.append("response_format", "verbose_json");
    const prompt = buildTranscriptionPrompt(options.prompt);
    if (prompt) form.append("prompt", prompt);

    // The Groq SDK call is replaced by a direct POST. A deadline timeout becomes a readable message below.
    const reply = await runWithDeadline(options.signal, REQUEST_TIMEOUT_MS, async (signal) => {
      const response = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
        signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("Groq rejected the API key. Check it in Settings → API & Providers."), { status: response.status });
      }
      if (response.status === 429) throw new Error("Groq rate limit reached.");
      if (!response.ok) throw new Error(`Groq API request failed with status ${response.status}.`);
      return await response.json() as GroqVerboseReply;
    }).catch((err: unknown) => {
      if (err instanceof Error && err.message === "Request timed out.") throw new Error("Groq did not answer in time.");
      throw err;
    });

    const rawText = (reply.text ?? "").trim();
    debug("groq", `Success: ${rawText.length} chars`);

    if (!rawText) throw new Error("No speech detected in the recording.");

    const segments = reply.segments ?? [];
    const segmentNoSpeechProbabilities = segments.flatMap((segment) => typeof segment.no_speech_prob === "number" ? [segment.no_speech_prob] : []);
    return {
      rawText,
      formattedText: rawText,
      language: resolveReportedLanguage(options.language),
      detectedLanguage: reply.language || null,
      quality: {
        provider: "groq",
        attemptCount: 1,
        supportsConfidence: true,
        avgLogprob: averageNumber(segments.map((segment) => segment.avg_logprob)),
        compressionRatio: averageNumber(segments.map((segment) => segment.compression_ratio)),
        noSpeechProbability: maxNumber(segments.map((segment) => segment.no_speech_prob)),
        segmentCount: segments.length,
        transcriptLength: rawText.length,
        ...(segmentNoSpeechProbabilities.length > 0 ? { segmentNoSpeechProbabilities } : {}),
      },
    };
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async validateApiKey(apiKey): Promise<{ valid: boolean; message: string }> {
    return validateBearerEndpoint("Groq", `${GROQ_BASE_URL}/models`, apiKey);
  },
};

// Opens a connection to Groq ahead of the real request, so the clip upload skips the TCP and TLS setup.
export function warmGroqConnection(): void {
  void fetch(`${GROQ_BASE_URL}/models`, {
    method: "HEAD",
    signal: AbortSignal.timeout(WARM_UP_TIMEOUT_MS),
  }).catch(() => undefined);
}

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
