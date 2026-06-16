import type { AudioClip, TranscriptionResult } from "@shared/types";
import type { TranscriptionProvider } from "../types";
import { buildTranscriptionPrompt, normalizeWhisperLanguage, resolveReportedLanguage } from "@main/providers/language";
import { unavailableValidation, validateBearerEndpoint } from "../validation";

const STT_TIMEOUT_MS = 20_000;
function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = STT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

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

export const OpenAISttProvider: TranscriptionProvider = {
  id: "openai",
  name: "OpenAI Whisper",
  requiresApiKey: true,
  models: [{ id: "whisper-1", name: "Whisper v1" }],

  async transcribe(clip, options): Promise<TranscriptionResult> {
    if (!options.apiKey) throw new Error("OpenAI API key not configured. Go to Settings → API & Providers.");

    const wavBuffer = createWavBuffer(clip);
    const blob = new Blob([new Uint8Array(wavBuffer)], { type: "audio/wav" });
    const formData = new FormData();
    formData.append("file", blob, "recording.wav");
    formData.append("model", options.model || "whisper-1");
    formData.append("response_format", "json");
    formData.append("temperature", String(options.temperature ?? 0));
    const language = normalizeWhisperLanguage(options.language);
    if (language) {
      formData.append("language", language);
    }
    const prompt = buildTranscriptionPrompt(options.language, options.prompt);
    if (prompt) {
      formData.append("prompt", prompt);
    }

    const response = await fetchWithTimeout(options.baseUrl
      ? `${options.baseUrl}/audio/transcriptions`
      : "https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`OpenAI API is temporarily unavailable. Please try again.`);
    }

    const data = await response.json() as { text: string };
    const rawText = (data.text ?? "").trim();
    if (!rawText) throw new Error("No speech detected.");
    const resolvedLanguage = resolveReportedLanguage(options.language);
    return { rawText, formattedText: rawText, language: resolvedLanguage };
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async validateApiKey(apiKey): Promise<{ valid: boolean; message: string }> {
    return validateBearerEndpoint("OpenAI", "https://api.openai.com/v1/models", apiKey);
  },
};

export const OpenAISttCompatibleProvider: TranscriptionProvider = {
  id: "openai-compatible",
  name: "OpenAI Compatible",
  requiresApiKey: true,
  models: [{ id: "whisper-1", name: "Whisper v1 (compatible)" }],

  async transcribe(clip, options): Promise<TranscriptionResult> {
    if (!options.apiKey) throw new Error("OpenAI Compatible API key not configured. Go to Settings → API & Providers.");
    if (!options.baseUrl) throw new Error("Base URL required for OpenAI Compatible provider.");

    const wavBuffer = createWavBuffer(clip);
    const blob = new Blob([new Uint8Array(wavBuffer)], { type: "audio/wav" });
    const formData = new FormData();
    formData.append("file", blob, "recording.wav");
    formData.append("model", options.model || "whisper-1");
    formData.append("response_format", "json");
    formData.append("temperature", String(options.temperature ?? 0));
    const language = normalizeWhisperLanguage(options.language);
    if (language) {
      formData.append("language", language);
    }
    const prompt = buildTranscriptionPrompt(options.language, options.prompt);
    if (prompt) {
      formData.append("prompt", prompt);
    }

    const url = options.baseUrl.endsWith("/") ? `${options.baseUrl}audio/transcriptions` : `${options.baseUrl}/audio/transcriptions`;
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`OpenAI Compatible API is temporarily unavailable. Please try again.`);
    }

    const data = await response.json() as { text: string };
    const rawText = (data.text ?? "").trim();
    if (!rawText) throw new Error("No speech detected.");
    const resolvedLanguage = resolveReportedLanguage(options.language);
    return { rawText, formattedText: rawText, language: resolvedLanguage };
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async validateApiKey(): Promise<{ valid: boolean; message: string }> {
    return unavailableValidation("OpenAI Compatible");
  },
};
