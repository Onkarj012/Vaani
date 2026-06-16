import type { AudioClip, TranscriptionResult } from "@shared/types";
import type { TranscriptionProvider } from "../types";
import { normalizeDeepgramLanguage, resolveReportedLanguage } from "@main/providers/language";
import { validateBearerEndpoint } from "../validation";

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
      results?: { channels?: { alternatives?: { transcript: string }[] }[] };
    };

    const rawText = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
    if (!rawText) throw new Error("No speech detected.");
    return { rawText, formattedText: rawText, language: resolveReportedLanguage(options.language) };
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async validateApiKey(apiKey): Promise<{ valid: boolean; message: string }> {
    return validateBearerEndpoint("Deepgram", "https://api.deepgram.com/v1/projects", apiKey, "Token");
  },
};
