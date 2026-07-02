import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { AudioClip, TranscriptionResult } from "@shared/types";
import type { FormattingProvider, TranscriptionProvider } from "@main/providers/types";

const registryState = vi.hoisted(() => ({
  providers: new Map<string, TranscriptionProvider>(),
  formattingProviders: new Map<string, FormattingProvider>(),
}));

vi.mock("@main/providers", () => ({
  getProviderRegistry: () => ({
    getTranscription: (id: string) => registryState.providers.get(id),
    getFormatting: (id: string) => registryState.formattingProviders.get(id),
  }),
}));

function provider(id: string, transcribe: TranscriptionProvider["transcribe"], requiresApiKey = true): TranscriptionProvider {
  return {
    id,
    name: id,
    requiresApiKey,
    models: [],
    transcribe,
    isAvailable: vi.fn(async () => true),
  };
}

function formattingProvider(id: string, format: FormattingProvider["format"], requiresApiKey = true): FormattingProvider {
  return {
    id,
    name: id,
    requiresApiKey,
    models: [],
    format,
    isAvailable: vi.fn(async () => true),
  };
}

const clip: AudioClip = { pcmData: [0.1, 0.2], sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] };

describe("TranscriptionService failover chain", () => {
  beforeEach(() => {
    registryState.providers.clear();
    registryState.formattingProviders.clear();
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

  it("passes vocabulary context to STT instead of the LLM formatting prompt", async () => {
    const primaryTranscribe = vi.fn(async (): Promise<TranscriptionResult> => ({
      rawText: "open GitHub",
      formattedText: "open GitHub",
      language: "en",
    }));
    registryState.providers.set("groq", provider("groq", primaryTranscribe));
    const { TranscriptionService } = await import("@main/transcription");

    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      customPrompt: "Turn this into bullet points and clean up grammar.",
      customCorrections: [{ spoken: "get hub", written: "GitHub" }],
      snippets: [{ trigger: "email", content: "onkar@example.com" }],
      groqApiKey: "groq-key",
    }));

    await service.transcribe(clip);

    expect(primaryTranscribe).toHaveBeenCalledWith(clip, expect.objectContaining({
      prompt: "GitHub, onkar@example.com",
    }));
    expect(primaryTranscribe).not.toHaveBeenCalledWith(clip, expect.objectContaining({
      prompt: expect.stringContaining("bullet points"),
    }));
  });

  it("excludes risky or oversized terms from STT vocabulary context", async () => {
    const primaryTranscribe = vi.fn(async (): Promise<TranscriptionResult> => ({
      rawText: "open GitHub",
      formattedText: "open GitHub",
      language: "en",
    }));
    registryState.providers.set("groq", provider("groq", primaryTranscribe));
    const { TranscriptionService } = await import("@main/transcription");

    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      customCorrections: [
        { spoken: "get hub", written: "GitHub" },
        { spoken: "it", written: "1 It" },
        { spoken: "long", written: "alpha beta gamma delta" },
        { spoken: "wide", written: "supercalifragilistic-expialidocious-overflow" },
      ],
      snippets: [{ trigger: "ok", content: "release notes" }],
      groqApiKey: "groq-key",
    }));

    await service.transcribe(clip);

    expect(primaryTranscribe).toHaveBeenCalledWith(clip, expect.objectContaining({
      prompt: "GitHub, release notes",
    }));
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

  it("retries a suspicious successful transcript with the same provider before falling back", async () => {
    const openaiTranscribe = vi.fn(async (): Promise<TranscriptionResult> => ({
      rawText: "thank you",
      formattedText: "thank you",
      language: "en",
      quality: {
        provider: "openai",
        attemptCount: 1,
        supportsConfidence: true,
        noSpeechProbability: 0.9,
        transcriptLength: 9,
      },
    }));
    const groqTranscribe = vi.fn(async (): Promise<TranscriptionResult> => ({
      rawText: "real fallback",
      formattedText: "real fallback",
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

    const result = await service.transcribe(clip, {
      rejectResult: (candidate) => candidate.quality?.noSpeechProbability === 0.9,
      retryClip: { ...clip, durationSeconds: 2 },
    });

    expect(result.rawText).toBe("real fallback");
    expect(openaiTranscribe).toHaveBeenCalledTimes(2);
    expect(openaiTranscribe).toHaveBeenNthCalledWith(1, clip, expect.anything());
    expect(openaiTranscribe).toHaveBeenNthCalledWith(2, expect.objectContaining({ durationSeconds: 2 }), expect.anything());
    expect(groqTranscribe).toHaveBeenCalledTimes(1);
    expect(result.quality?.attemptCount).toBe(3);
    expect(result.providerAttempts).toHaveLength(3);
  });

  it("retries a suspicious successful transcript once for single-provider users", async () => {
    const groqTranscribe = vi.fn(async (): Promise<TranscriptionResult> => ({
      rawText: "thank you",
      formattedText: "thank you",
      language: "en",
      quality: {
        provider: "groq",
        attemptCount: 1,
        supportsConfidence: true,
        noSpeechProbability: 0.9,
        transcriptLength: 9,
      },
    }));
    registryState.providers.set("groq", provider("groq", groqTranscribe));
    const { TranscriptionService } = await import("@main/transcription");

    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      transcriptionProvider: "groq",
      failoverEnabled: false,
      groqApiKey: "groq-key",
    }));

    const result = await service.transcribe(clip, {
      rejectResult: (candidate) => candidate.quality?.noSpeechProbability === 0.9,
      retryClip: { ...clip, durationSeconds: 2 },
    });

    expect(groqTranscribe).toHaveBeenCalledTimes(2);
    expect(result.rawText).toBe("thank you");
    expect(result.quality?.attemptCount).toBe(2);
    expect(result.providerAttempts).toHaveLength(2);
  });

  it("returns the same provider retry result without calling fallback when retry succeeds", async () => {
    const openaiTranscribe = vi.fn()
      .mockResolvedValueOnce({
        rawText: "thank you",
        formattedText: "thank you",
        language: "en",
        quality: {
          provider: "openai",
          attemptCount: 1,
          supportsConfidence: true,
          noSpeechProbability: 0.9,
          transcriptLength: 9,
        },
      } satisfies TranscriptionResult)
      .mockResolvedValueOnce({
        rawText: "actual words",
        formattedText: "actual words",
        language: "en",
      } satisfies TranscriptionResult);
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

    const result = await service.transcribe(clip, {
      rejectResult: (candidate) => candidate.rawText === "thank you",
      retryClip: { ...clip, durationSeconds: 2 },
    });

    expect(result.rawText).toBe("actual words");
    expect(openaiTranscribe).toHaveBeenCalledTimes(2);
    expect(groqTranscribe).not.toHaveBeenCalled();
    expect(result.quality?.attemptCount).toBe(2);
    expect(result.providerAttempts).toHaveLength(2);
  });

  it("honors always-offline by routing only to local whisper", async () => {
    const groqTranscribe = vi.fn();
    const localTranscribe = vi.fn(async (): Promise<TranscriptionResult> => ({
      rawText: "local",
      formattedText: "local",
      language: "en",
    }));
    registryState.providers.set("groq", provider("groq", groqTranscribe));
    registryState.providers.set("local-whisper", provider("local-whisper", localTranscribe, false));
    const { TranscriptionService } = await import("@main/transcription");

    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      transcriptionProvider: "groq",
      offlineMode: "always-offline",
      groqApiKey: "groq-key",
    }));

    await expect(service.transcribe(clip)).resolves.toMatchObject({ rawText: "local" });
    expect(groqTranscribe).not.toHaveBeenCalled();
    expect(localTranscribe).toHaveBeenCalledTimes(1);
  });

  it("honors always-online by excluding local whisper fallback", async () => {
    registryState.providers.set("groq", provider("groq", vi.fn(async () => {
      throw new Error("cloud down");
    })));
    registryState.providers.set("local-whisper", provider("local-whisper", vi.fn(async (): Promise<TranscriptionResult> => ({
      rawText: "local",
      formattedText: "local",
      language: "en",
    })), false));
    const { TranscriptionService } = await import("@main/transcription");

    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      transcriptionProvider: "groq",
      offlineMode: "always-online",
      failoverEnabled: true,
      groqApiKey: "groq-key",
    }));

    await expect(service.transcribe(clip)).rejects.toThrow("cloud down");
  });

  it("uses a per-app provider override as the primary provider", async () => {
    const openaiTranscribe = vi.fn(async (): Promise<TranscriptionResult> => ({
      rawText: "override",
      formattedText: "override",
      language: "en",
    }));
    const groqTranscribe = vi.fn();
    registryState.providers.set("openai", provider("openai", openaiTranscribe));
    registryState.providers.set("groq", provider("groq", groqTranscribe));
    const { TranscriptionService } = await import("@main/transcription");

    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      transcriptionProvider: "groq",
      providerApiKeys: [{ providerId: "openai", key: "openai-key" }],
      groqApiKey: "groq-key",
    }));

    await expect(service.transcribe(clip, { providerOverride: "openai" })).resolves.toMatchObject({ rawText: "override" });
    expect(openaiTranscribe).toHaveBeenCalledTimes(1);
    expect(groqTranscribe).not.toHaveBeenCalled();
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

  it("marks content-guard rejection as raw cleanup fallback", async () => {
    registryState.formattingProviders.set("groq-llm", formattingProvider("groq-llm", vi.fn(async () => "I this.")));
    const { TranscriptionService } = await import("@main/transcription");

    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      groqApiKey: "groq-key",
    }));

    const result = await service.formatTranscriptDetailed("um I like this");

    expect(result).toEqual({
      text: "um I like this",
      formatterUsed: "guard-fallback",
      contentGuardVerdict: { passed: false, missingWords: ["like"] },
    });
  });
});
