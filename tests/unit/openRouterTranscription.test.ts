import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { AudioClip, Settings, TranscriptionResult } from "@shared/types";
import type { TranscribeOptions } from "@main/transcription";
import type { TranscriptionProvider } from "@main/providers/types";
import { OpenRouterSttProvider } from "@main/providers/openrouter/openRouterStt";

const registryState = vi.hoisted(() => ({
  providers: new Map<string, TranscriptionProvider>(),
}));

vi.mock("@main/providers", () => ({
  getProviderRegistry: () => ({
    getTranscription: (id: string) => registryState.providers.get(id),
    getFormatting: () => undefined,
  }),
}));

interface SentBody {
  model: string;
  input_audio: { format: string; data: string };
  temperature: number;
  provider?: { options: Record<string, Record<string, string | string[]>> };
}

const clip: AudioClip = { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: new Array(50).fill(0.1) };

function jsonReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function settingsWith(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    providerApiKeys: [{ providerId: "openrouter", key: "or-key" }],
    groqApiKey: "groq-key",
    ...overrides,
  };
}

async function transcribeWith(settings: Settings, options?: TranscribeOptions) {
  const { TranscriptionService } = await import("@main/transcription");
  return new TranscriptionService(() => settings).transcribe(clip, options);
}

describe("OpenRouter transcription through the service", () => {
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
  let groqTranscribe: Mock<TranscriptionProvider["transcribe"]>;

  beforeEach(() => {
    groqTranscribe = vi.fn<TranscriptionProvider["transcribe"]>(async (): Promise<TranscriptionResult> => ({
      rawText: "from groq", formattedText: "from groq", language: "en",
    }));
    registryState.providers.set("openrouter", OpenRouterSttProvider);
    registryState.providers.set("groq", {
      id: "groq", name: "Groq", requiresApiKey: true, models: [], transcribe: groqTranscribe, isAvailable: async () => true,
    });
    fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => jsonReply({ text: " hello there " }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    registryState.providers.clear();
  });

  function sentBody(): SentBody {
    return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  }

  it("sends the clip to the transcriptions endpoint with the selected model", async () => {
    const result = await transcribeWith(settingsWith());

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect(sentBody()).toMatchObject({ model: "openai/gpt-transcribe", input_audio: { format: "wav" }, temperature: 0 });
    expect(result.rawText).toBe("hello there");
    expect(result.providerAttempts?.[0]).toMatchObject({ provider: "openrouter", model: "openai/gpt-transcribe", success: true });
    expect(groqTranscribe).not.toHaveBeenCalled();
  });

  it("sends dictionary hints on a clip under 2 seconds and reports that they were sent", async () => {
    const result = await transcribeWith(settingsWith({ customCorrections: [{ spoken: "get hub", written: "GitHub" }] }));

    expect(sentBody().provider).toEqual({ options: { openai: { prompt: "GitHub" } } });
    expect(result.quality?.vocabularyHintsSent).toBe(true);
  });

  it("leaves disabled dictionary entries out of the hints", async () => {
    await transcribeWith(settingsWith({
      customCorrections: [
        { spoken: "get hub", written: "GitHub" },
        { spoken: "versel", written: "Vercel", enabled: false },
      ],
    }));

    expect(sentBody().provider).toEqual({ options: { openai: { prompt: "GitHub" } } });
  });

  it("sends list hints as a list for models that take one", async () => {
    await transcribeWith(settingsWith({
      transcriptionModel: "elevenlabs/scribe-v2",
      customCorrections: [{ spoken: "get hub", written: "GitHub" }, { spoken: "versel", written: "Vercel" }],
    }));

    expect(sentBody().provider).toEqual({ options: { elevenlabs: { keyterms: ["GitHub", "Vercel"] } } });
  });

  it("sends no hints to a model without hint support and reports it", async () => {
    const result = await transcribeWith(settingsWith({
      transcriptionModel: "x-ai/grok-stt-1.0",
      customCorrections: [{ spoken: "get hub", written: "GitHub" }],
    }));

    expect(sentBody().provider).toBeUndefined();
    expect(result.quality?.vocabularyHintsSent).toBe(false);
  });

  it("falls back to Groq when OpenRouter returns an error", async () => {
    fetchMock.mockResolvedValueOnce(jsonReply({ error: "boom" }, 500));

    const result = await transcribeWith(settingsWith());

    expect(result.rawText).toBe("from groq");
    expect(result.providerAttempts?.map((attempt) => attempt.provider)).toEqual(["openrouter", "groq"]);
    expect(result.providerAttempts?.[1]).toMatchObject({
      provider: "groq",
      model: "whisper-large-v3-turbo",
      fallbackReason: "OpenRouter API request failed with status 500.",
    });
    expect(groqTranscribe).toHaveBeenCalledOnce();
  });

  it("falls back to Groq when OpenRouter is out of credit", async () => {
    fetchMock.mockResolvedValueOnce(jsonReply({ error: "insufficient credits" }, 402));

    const result = await transcribeWith(settingsWith());

    expect(result.rawText).toBe("from groq");
    expect(result.providerAttempts?.[1]?.fallbackReason).toBe("OpenRouter API request failed with status 402.");
  });

  it("falls back to Groq when OpenRouter times out, with time left for Groq", async () => {
    fetchMock.mockImplementationOnce((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));

    const result = await transcribeWith(settingsWith(), { deadlineAt: Date.now() + 2_000 });

    expect(result.rawText).toBe("from groq");
    expect(result.providerAttempts?.[0]).toMatchObject({ provider: "openrouter", success: false, errorClass: "timeout", error: "Request timed out." });
    expect(groqTranscribe.mock.calls[0]?.[1].signal?.aborted).toBe(false);
  });

  it("does not fall back to Groq when no Groq key is saved", async () => {
    fetchMock.mockResolvedValueOnce(jsonReply({ error: "boom" }, 500));

    await expect(transcribeWith(settingsWith({ groqApiKey: "" }))).rejects.toThrow("status 500");
    expect(groqTranscribe).not.toHaveBeenCalled();
  });

  it("uses Groq directly, with the reason, when no OpenRouter key is saved", async () => {
    const result = await transcribeWith(settingsWith({ providerApiKeys: [] }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.rawText).toBe("from groq");
    expect(result.providerAttempts?.[0]).toMatchObject({
      provider: "groq",
      model: "whisper-large-v3-turbo",
      fallbackReason: 'No API key saved for "openrouter".',
    });
  });
});
