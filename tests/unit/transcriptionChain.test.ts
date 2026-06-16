import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { AudioClip, TranscriptionResult } from "@shared/types";
import type { TranscriptionProvider } from "@main/providers/types";

const registryState = vi.hoisted(() => ({
  providers: new Map<string, TranscriptionProvider>(),
}));

vi.mock("@main/providers", () => ({
  getProviderRegistry: () => ({
    getTranscription: (id: string) => registryState.providers.get(id),
    getFormatting: () => undefined,
  }),
}));

function provider(id: string, transcribe: TranscriptionProvider["transcribe"]): TranscriptionProvider {
  return {
    id,
    name: id,
    requiresApiKey: true,
    models: [],
    transcribe,
    isAvailable: vi.fn(async () => true),
  };
}

const clip: AudioClip = { pcmData: [0.1, 0.2], sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] };

describe("TranscriptionService failover chain", () => {
  beforeEach(() => {
    registryState.providers.clear();
  });

  it("returns the primary provider result when it succeeds", async () => {
    const primaryTranscribe = vi.fn(async (): Promise<TranscriptionResult> => ({
      rawText: "primary",
      formattedText: "primary",
      language: "en",
    }));
    registryState.providers.set("openai", provider("openai", primaryTranscribe));
    const { TranscriptionService } = await import("@main/transcription");

    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      transcriptionProvider: "openai",
      providerApiKeys: [{ providerId: "openai", key: "openai-key" }],
    }));

    await expect(service.transcribe(clip)).resolves.toMatchObject({ rawText: "primary" });
    expect(primaryTranscribe).toHaveBeenCalledWith(clip, expect.objectContaining({ apiKey: "openai-key" }));
  });

  it("falls through from a failing primary provider to the next configured fallback", async () => {
    const openaiTranscribe = vi.fn(async () => {
      throw new Error("temporary outage");
    });
    const groqTranscribe = vi.fn(async (): Promise<TranscriptionResult> => ({
      rawText: "fallback",
      formattedText: "fallback",
      language: "en",
    }));
    registryState.providers.set("openai", provider("openai", openaiTranscribe));
    registryState.providers.set("groq", provider("groq", groqTranscribe));
    const { TranscriptionService } = await import("@main/transcription");

    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      transcriptionProvider: "openai",
      failoverEnabled: true,
      groqApiKey: "groq-key",
      providerApiKeys: [{ providerId: "openai", key: "openai-key" }],
    }));

    await expect(service.transcribe(clip)).resolves.toMatchObject({ rawText: "fallback" });
    expect(openaiTranscribe).toHaveBeenCalledTimes(1);
    expect(groqTranscribe).toHaveBeenCalledTimes(1);
  });

  it("skips providers that require an API key when no key resolves", async () => {
    const openaiTranscribe = vi.fn();
    registryState.providers.set("openai", provider("openai", openaiTranscribe));
    const { TranscriptionService } = await import("@main/transcription");

    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      transcriptionProvider: "openai",
      groqApiKey: "",
      providerApiKeys: [],
    }));

    await expect(service.transcribe(clip)).rejects.toThrow("no API key configured");
    expect(openaiTranscribe).not.toHaveBeenCalled();
  });

  it("surfaces the last provider error when every configured provider fails", async () => {
    registryState.providers.set("groq", provider("groq", vi.fn(async () => {
      throw new Error("first failure");
    })));
    registryState.providers.set("openai", provider("openai", vi.fn(async () => {
      throw new Error("last failure");
    })));
    const { TranscriptionService } = await import("@main/transcription");

    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      transcriptionProvider: "groq",
      failoverEnabled: true,
      groqApiKey: "groq-key",
      providerApiKeys: [{ providerId: "openai", key: "openai-key" }],
    }));

    await expect(service.transcribe(clip)).rejects.toThrow("last failure");
  });
});
