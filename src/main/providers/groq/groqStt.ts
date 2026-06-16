import Groq from "groq-sdk";
import type { AudioClip, TranscriptionResult } from "@shared/types";
import type { TranscriptionProvider } from "../types";
import { debug, error } from "@main/log";
import { buildTranscriptionPrompt, normalizeWhisperLanguage, resolveReportedLanguage } from "@main/providers/language";
import { validateBearerEndpoint } from "../validation";

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const ATTEMPT_TIMEOUT_MS = 15_000;

function createWavBuffer(audio: AudioClip): Buffer {
  const dataSize = audio.pcmData.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(audio.sampleRate, 24);
  buf.writeUInt32LE(audio.sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < audio.pcmData.length; i++) {
    const s = Math.max(-1, Math.min(1, audio.pcmData[i] ?? 0));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

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
    const prompt = buildTranscriptionPrompt(options.language, options.prompt);

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
          ...(prompt ? { prompt } : {}),
        }, { signal: controller.signal });
        clearTimeout(attemptTimer);

        const rawText = (response.text ?? "").trim();
        debug("groq", `Success: ${rawText.length} chars`);

        if (!rawText) throw new Error("No speech detected in the recording.");

        return {
          rawText,
          formattedText: rawText,
          language: resolveReportedLanguage(options.language),
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

function isNotRetryableError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("no speech") ||
    lower.includes("401") || lower.includes("403") ||
    lower.includes("unauthorized") || lower.includes("authentication") ||
    lower.includes("invalid api key") || lower.includes("incorrect api key");
}
