import type { AudioClip, TranscriptionResult } from "@shared/types";
import type { TranscriptionProvider } from "../types";

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
    if (!options.apiKey) throw new Error("OpenAI API key not configured.");

    const wavBuffer = createWavBuffer(clip);
    const blob = new Blob([new Uint8Array(wavBuffer)], { type: "audio/wav" });
    const formData = new FormData();
    formData.append("file", blob, "recording.wav");
    formData.append("model", options.model || "whisper-1");
    formData.append("response_format", "json");
    formData.append("temperature", String(options.temperature ?? 0));
    if (options.language && options.language !== "auto") {
      formData.append("language", options.language);
    }
    if (options.prompt) {
      formData.append("prompt", options.prompt);
    }

    const response = await fetch(options.baseUrl
      ? `${options.baseUrl}/audio/transcriptions`
      : "https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${body}`);
    }

    const data = await response.json() as { text: string };
    const rawText = (data.text ?? "").trim();
    if (!rawText) throw new Error("No speech detected.");
    return { rawText, formattedText: rawText, language: options.language ?? "en" };
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },
};

export const OpenAISttCompatibleProvider: TranscriptionProvider = {
  id: "openai-compatible",
  name: "OpenAI Compatible",
  requiresApiKey: true,
  models: [{ id: "whisper-1", name: "Whisper v1 (compatible)" }],

  async transcribe(clip, options): Promise<TranscriptionResult> {
    if (!options.apiKey) throw new Error("API key not configured.");
    if (!options.baseUrl) throw new Error("Base URL required for OpenAI Compatible provider.");

    const wavBuffer = createWavBuffer(clip);
    const blob = new Blob([new Uint8Array(wavBuffer)], { type: "audio/wav" });
    const formData = new FormData();
    formData.append("file", blob, "recording.wav");
    formData.append("model", options.model || "whisper-1");
    formData.append("response_format", "json");
    formData.append("temperature", String(options.temperature ?? 0));
    if (options.language && options.language !== "auto") {
      formData.append("language", options.language);
    }

    const url = options.baseUrl.endsWith("/") ? `${options.baseUrl}audio/transcriptions` : `${options.baseUrl}/audio/transcriptions`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error ${response.status}: ${body}`);
    }

    const data = await response.json() as { text: string };
    const rawText = (data.text ?? "").trim();
    if (!rawText) throw new Error("No speech detected.");
    return { rawText, formattedText: rawText, language: options.language ?? "en" };
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },
};
