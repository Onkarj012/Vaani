import { captureSessionSettings } from "@shared/sessionSettings";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { AudioClip, TranscriptionResult } from "@shared/types";
import type { FormattingProvider, TranscriptionProvider } from "@main/providers/types";
import { createCancellationScope } from "@main/cancellation";

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
const contextClip: AudioClip = { pcmData: new Array(32_000).fill(0.1), sampleRate: 16_000, durationSeconds: 2, rmsFrames: new Array(100).fill(0.1) };

describe("TranscriptionService failover chain", () => {
  beforeEach(() => {
    registryState.providers.clear();
    registryState.formattingProviders.clear();
  });

  it("keeps the captured route and language while resolving the current credential", async () => {
    const settings = { ...DEFAULT_SETTINGS, language: "hi", groqApiKey: "old-key", failoverEnabled: false };
    const snapshot = captureSessionSettings(settings);
    settings.transcriptionProvider = "openai";
    settings.language = "en";
    settings.groqApiKey = "rotated-key";
    const transcribe = vi.fn(async () => ({ rawText: "hello", formattedText: "hello", language: "hi" }));
    const other = vi.fn();
    registryState.providers.set("groq", provider("groq", transcribe));
    registryState.providers.set("openai", provider("openai", other));
    const { TranscriptionService } = await import("@main/transcription");
    await new TranscriptionService(() => settings).transcribe(clip, { sessionSettings: snapshot });
    expect(transcribe).toHaveBeenCalledWith(clip, expect.objectContaining({ language: "hi", apiKey: "rotated-key" }));
    expect(other).not.toHaveBeenCalled();
  });

  it("keeps the captured formatter model and prompt", async () => {
    const settings = { ...DEFAULT_SETTINGS, groqApiKey: "key", formattingModel: "original-model", customPrompt: "original-prompt" };
    const snapshot = captureSessionSettings(settings);
    settings.formattingProvider = "openai-llm";
    settings.formattingModel = "new-model";
    settings.customPrompt = "new-prompt";
    const format = vi.fn(async (text: string) => text);
    registryState.formattingProviders.set("groq-llm", formattingProvider("groq-llm", format));
    const { TranscriptionService } = await import("@main/transcription");
    await new TranscriptionService(() => settings).formatTranscript("hello", { sessionSettings: snapshot });
    expect(format).toHaveBeenCalledWith("hello", expect.objectContaining({ model: "original-model", systemPrompt: "original-prompt" }));
  });

  it("keeps the live session route after offline mode is enabled during a request", async () => {
    const settings = { ...DEFAULT_SETTINGS, groqApiKey: "key", failoverEnabled: true, providerApiKeys: [{ providerId: "openai", key: "other-key" }] };
    const other = vi.fn(async () => ({ rawText: "fallback", formattedText: "fallback", language: "en" }));
    registryState.providers.set("groq", provider("groq", vi.fn(async () => {
      settings.offlineMode = "always-offline";
      throw new Error("failed");
    })));
    registryState.providers.set("openai", provider("openai", other));
    const { TranscriptionService } = await import("@main/transcription");
    await expect(new TranscriptionService(() => settings).transcribe(clip)).resolves.toMatchObject({ rawText: "fallback" });
    expect(other).toHaveBeenCalledOnce();
  });

  it("does not start a provider for a pre-cancelled request", async () => {
    const transcribe = vi.fn();
    registryState.providers.set("groq", provider("groq", transcribe));
    const { TranscriptionService } = await import("@main/transcription");
    const controller = new AbortController();
    controller.abort();
    await expect(new TranscriptionService(() => ({ ...DEFAULT_SETTINGS, groqApiKey: "key" })).transcribe(clip, { signal: controller.signal })).rejects.toThrow();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("skips captured cloud formatting when current consent requires offline", async () => {
    const settings = { ...DEFAULT_SETTINGS, groqApiKey: "key" };
    const snapshot = captureSessionSettings(settings);
    settings.offlineMode = "always-offline";
    const format = vi.fn();
    registryState.formattingProviders.set("groq-llm", formattingProvider("groq-llm", format));
    const { TranscriptionService } = await import("@main/transcription");
    await expect(new TranscriptionService(() => settings).formatTranscript("raw text", { sessionSettings: snapshot })).resolves.toBe("raw text");
    expect(format).not.toHaveBeenCalled();
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

    await service.transcribe(contextClip, { speechContext: { trimmedDurationSeconds: 2, speechGatePassed: true } });

    expect(primaryTranscribe).toHaveBeenCalledWith(contextClip, expect.objectContaining({
      prompt: "GitHub",
    }));
    expect(primaryTranscribe).not.toHaveBeenCalledWith(contextClip, expect.objectContaining({
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

    await service.transcribe(contextClip, { speechContext: { trimmedDurationSeconds: 2, speechGatePassed: true } });

    expect(primaryTranscribe).toHaveBeenCalledWith(contextClip, expect.objectContaining({
      prompt: "GitHub",
    }));
  });

  it("omits vocabulary context for a short trimmed clip or a failed speech gate", async () => {
    const primaryTranscribe = vi.fn<TranscriptionProvider["transcribe"]>(async (): Promise<TranscriptionResult> => ({
      rawText: "hello", formattedText: "hello", language: "en",
    }));
    registryState.providers.set("groq", provider("groq", primaryTranscribe));
    const { TranscriptionService, buildSpeechContextPrompt } = await import("@main/transcription");
    const settings = {
      ...DEFAULT_SETTINGS,
      groqApiKey: "groq-key",
      customCorrections: [{ spoken: "get hub", written: "GitHub" }],
      snippets: [{ trigger: "email", content: "private snippet content" }],
    };
    const service = new TranscriptionService(() => settings);

    expect(buildSpeechContextPrompt(settings, { trimmedDurationSeconds: 1.99, speechGatePassed: true })).toBeUndefined();
    expect(buildSpeechContextPrompt(settings, { trimmedDurationSeconds: 2, speechGatePassed: false })).toBeUndefined();
    expect(buildSpeechContextPrompt(settings, { trimmedDurationSeconds: 2, speechGatePassed: true })).toBe("GitHub");

    await service.transcribe(contextClip, { speechContext: { trimmedDurationSeconds: 1.99, speechGatePassed: true } });
    await service.transcribe(contextClip, { speechContext: { trimmedDurationSeconds: 2, speechGatePassed: false } });
    await service.transcribe(clip, { speechContext: { trimmedDurationSeconds: 2, speechGatePassed: true } });
    await service.transcribe(contextClip);
    for (const call of primaryTranscribe.mock.calls) expect(call[1].prompt).toBeUndefined();
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

  it("makes three total attempts for a suspicious transcript with a single provider", async () => {
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

    expect(groqTranscribe).toHaveBeenCalledTimes(3);
    expect(result.rawText).toBe("thank you");
    expect(result.quality?.attemptCount).toBe(3);
    expect(result.providerAttempts).toHaveLength(3);
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
    const cloudFormat = vi.fn(async () => "cloud output");
    registryState.formattingProviders.set("groq-llm", formattingProvider("groq-llm", cloudFormat));
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

    const transcript = await service.transcribe(clip);
    expect(transcript.rawText).toBe("local");
    await expect(service.formatTranscriptDetailed(transcript.rawText)).resolves.toEqual({ text: "local", formatterUsed: "none" });
    expect(groqTranscribe).not.toHaveBeenCalled();
    expect(localTranscribe).toHaveBeenCalledTimes(1);
    expect(cloudFormat).not.toHaveBeenCalled();
  });

  it("uses the captured local model on live transcription and reserves the restore error for recovery", async () => {
    const settings = { ...DEFAULT_SETTINGS, offlineMode: "always-offline" as const, localWhisperModel: "small.en" };
    const snapshot = captureSessionSettings(settings);
    settings.localWhisperModel = "base.en";
    const local = vi.fn(async () => ({ rawText: "captured", formattedText: "captured", language: "en" }));
    registryState.providers.set("local-whisper", provider("local-whisper", local, false));
    const { TranscriptionService } = await import("@main/transcription");
    const service = new TranscriptionService(() => settings);
    await expect(service.transcribe(clip, { sessionSettings: snapshot })).resolves.toMatchObject({ rawText: "captured" });
    expect(local).toHaveBeenCalledOnce();
    expect(local).toHaveBeenCalledWith(clip, expect.objectContaining({ model: "small.en" }));
    await expect(service.transcribe(clip, { sessionSettings: snapshot, recovery: true })).rejects.toThrow("Restore local model");
  });

  it("does not fall back to cloud when offline transcription fails", async () => {
    const cloudTranscribe = vi.fn();
    registryState.providers.set("groq", provider("groq", cloudTranscribe));
    registryState.providers.set("local-whisper", provider("local-whisper", vi.fn(async () => {
      throw new Error("local model unavailable");
    }), false));
    const { TranscriptionService } = await import("@main/transcription");
    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      offlineMode: "always-offline",
      failoverEnabled: true,
      groqApiKey: "groq-key",
    }));

    await expect(service.transcribe(clip)).rejects.toThrow("local model unavailable");
    expect(cloudTranscribe).not.toHaveBeenCalled();
  });

  it.each(["groq-llm", "openai-llm", "anthropic", "openrouter", "keyless-remote"])(
    "skips %s formatting in offline mode without looking up credentials",
    async (formattingId) => {
      const format = vi.fn(async () => "unexpected remote result");
      registryState.formattingProviders.set(formattingId, formattingProvider(formattingId, format, formattingId !== "keyless-remote"));
      const { CredentialsStore, MemoryCredentialBackend } = await import("@main/store/credentials");
      const getCredential = vi.spyOn(CredentialsStore.prototype, "get");
      const { TranscriptionService } = await import("@main/transcription");
      const service = new TranscriptionService(() => ({
        ...DEFAULT_SETTINGS,
        offlineMode: "always-offline",
        formattingProvider: formattingId,
      }), new CredentialsStore(new MemoryCredentialBackend()));
      const rawText = "Keep this identifier release_v1.3\n\nआणि हा मजकूर";

      await expect(service.formatTranscriptDetailed(rawText)).resolves.toEqual({ text: rawText, formatterUsed: "none" });
      expect(getCredential).not.toHaveBeenCalled();
      expect(format).not.toHaveBeenCalled();
    },
  );

  it.each(["auto", "always-online"] as const)("keeps cloud formatting available in %s mode", async (offlineMode) => {
    const format = vi.fn(async (text: string) => text);
    registryState.formattingProviders.set("groq-llm", formattingProvider("groq-llm", format));
    const { TranscriptionService } = await import("@main/transcription");
    const service = new TranscriptionService(() => ({ ...DEFAULT_SETTINGS, offlineMode, groqApiKey: "groq-key" }));

    await expect(service.formatTranscriptDetailed("Keep this text unchanged")).resolves.toMatchObject({ formatterUsed: "llm" });
    expect(format).toHaveBeenCalledTimes(1);
  });

  it("honors cancellation when skipping offline formatting", async () => {
    const { TranscriptionService, TranscriptionCancelledError } = await import("@main/transcription");
    const service = new TranscriptionService(() => ({ ...DEFAULT_SETTINGS, offlineMode: "always-offline" }));
    const controller = new AbortController();
    controller.abort();

    await expect(service.formatTranscriptDetailed("private text", { signal: controller.signal })).rejects.toBeInstanceOf(TranscriptionCancelledError);
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

  it("chunks long recordings at silence-snapped boundaries and merges the full transcript in order", async () => {
    const groqTranscribe = vi.fn(async (nextClip: AudioClip): Promise<TranscriptionResult> => {
      const chunkNumber = groqTranscribe.mock.calls.length;
      return {
        rawText: `chunk-${chunkNumber}`,
        formattedText: `chunk-${chunkNumber}`,
        language: "en",
        quality: {
          provider: "groq",
          attemptCount: 1,
          supportsConfidence: true,
          avgLogprob: -0.2,
          compressionRatio: 1,
          noSpeechProbability: 0,
          segmentCount: 1,
          transcriptLength: nextClip.pcmData.length,
        },
      };
    });
    registryState.providers.set("groq", provider("groq", groqTranscribe));
    const { TranscriptionService } = await import("@main/transcription");
    const longClip: AudioClip = {
      pcmData: new Array(160 * 16_000).fill(0.1),
      sampleRate: 16_000,
      durationSeconds: 160,
      rmsFrames: new Array(8_000).fill(0.1),
    };
    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      transcriptionProvider: "groq",
      groqApiKey: "groq-key",
    }));

    const result = await service.transcribe(longClip);

    expect(groqTranscribe).toHaveBeenCalledTimes(6);
    expect(groqTranscribe.mock.calls.map(([candidate]) => Math.round(candidate.durationSeconds))).toEqual([28, 28, 28, 28, 28, 20]);
    expect(result.rawText).toBe("chunk-1 chunk-2 chunk-3 chunk-4 chunk-5 chunk-6");
    expect(result.quality?.segmentCount).toBe(6);
    expect(result.quality?.chunkCount).toBe(6);
    expect(result.quality?.chunkOverlapSeconds).toBe(2);
  });

  it("does not issue another chunk request after the transcription deadline", async () => {
    vi.useFakeTimers();
    try {
      const groqTranscribe = vi.fn(() => new Promise<TranscriptionResult>((resolve) => {
        setTimeout(() => resolve({ rawText: "chunk", formattedText: "chunk", language: "en" }), 50_000);
      }));
      registryState.providers.set("groq", provider("groq", groqTranscribe));
      const { TranscriptionService, getTranscriptionTimeoutMs } = await import("@main/transcription");
      const longClip: AudioClip = {
        pcmData: new Array(181 * 16_000).fill(0.1),
        sampleRate: 16_000,
        durationSeconds: 181,
        rmsFrames: [],
      };
      const service = new TranscriptionService(() => ({
        ...DEFAULT_SETTINGS,
        transcriptionProvider: "groq",
        groqApiKey: "groq-key",
      }));
      const deadlineAt = Date.now() + getTranscriptionTimeoutMs(longClip.durationSeconds);
      const result = service.transcribe(longClip, { deadlineAt });
      const timedOut = expect(result).rejects.toThrow("Transcription deadline exceeded.");

      await vi.advanceTimersByTimeAsync(50_000);
      expect(groqTranscribe).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(50_000);

      await timedOut;
      expect(groqTranscribe).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deduplicates overlapped words when merging long-recording chunks", async () => {
    const transcripts = [
      "alpha beta gamma delta",
      "beta gamma delta epsilon zeta",
      "delta epsilon zeta eta",
    ];
    const groqTranscribe = vi.fn(async (): Promise<TranscriptionResult> => {
      const index = groqTranscribe.mock.calls.length - 1;
      const rawText = transcripts[index] ?? "";
      return {
        rawText,
        formattedText: rawText,
        language: "en",
        quality: {
          provider: "groq",
          attemptCount: 1,
          supportsConfidence: true,
          avgLogprob: -0.2,
          compressionRatio: 1,
          noSpeechProbability: 0,
          segmentCount: 1,
          transcriptLength: rawText.length,
        },
      };
    });
    registryState.providers.set("groq", provider("groq", groqTranscribe));
    const { TranscriptionService } = await import("@main/transcription");
    const longClip: AudioClip = {
      pcmData: new Array(62 * 16_000).fill(0.1),
      sampleRate: 16_000,
      durationSeconds: 62,
      rmsFrames: new Array(3_100).fill(0.1),
    };
    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      transcriptionProvider: "groq",
      groqApiKey: "groq-key",
    }));

    const result = await service.transcribe(longClip);

    expect(groqTranscribe).toHaveBeenCalledTimes(3);
    expect(result.rawText).toBe("alpha beta gamma delta epsilon zeta eta");
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
      text: "Um I like this.",
      formatterUsed: "guard-fallback",
      contentGuardVerdict: { passed: false, missingWords: ["like"] },
    });
  });

  it("falls back to corrected raw text when the formatter omits the last word", async () => {
    registryState.formattingProviders.set("groq-llm", formattingProvider("groq-llm", vi.fn(async () => "We ship it.")));
    const { TranscriptionService } = await import("@main/transcription");
    const service = new TranscriptionService(() => ({ ...DEFAULT_SETTINGS, groqApiKey: "groq-key" }));

    expect(await service.formatTranscriptDetailed("we ship it Tuesday")).toEqual({
      text: "We ship it Tuesday.",
      formatterUsed: "guard-fallback",
      contentGuardVerdict: { passed: false, missingWords: ["tuesday"] },
    });
  });

  it("formats blank-line separated transcript blocks independently", async () => {
    const format = vi.fn(async (text: string) => text === "first block"
      ? "First block."
      : "Second block.");
    registryState.formattingProviders.set("groq-llm", formattingProvider("groq-llm", format));
    const { TranscriptionService } = await import("@main/transcription");

    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      groqApiKey: "groq-key",
    }));

    const result = await service.formatTranscriptDetailed("first block\n\nsecond block");

    expect(format).toHaveBeenCalledTimes(2);
    expect(format).toHaveBeenNthCalledWith(1, "first block", expect.anything());
    expect(format).toHaveBeenNthCalledWith(2, "second block", expect.anything());
    expect(result).toEqual({
      text: "First block.\n\nSecond block.",
      formatterUsed: "llm",
      contentGuardVerdict: { passed: true },
    });
  });

  it("falls back only the multiline block that fails content guard", async () => {
    const format = vi.fn(async (text: string) => text === "alpha beta"
      ? "Alpha."
      : "Gamma delta.");
    registryState.formattingProviders.set("groq-llm", formattingProvider("groq-llm", format));
    const { TranscriptionService } = await import("@main/transcription");

    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      groqApiKey: "groq-key",
    }));

    const result = await service.formatTranscriptDetailed("alpha beta\n\ngamma delta");

    expect(format).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      text: "Alpha beta.\n\nGamma delta.",
      formatterUsed: "guard-fallback",
      contentGuardVerdict: { passed: false, missingWords: ["beta"] },
    });
  });

  it("retries one transient recovery failure before accepting the provider result", async () => {
    const transcribe = vi.fn()
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValueOnce({ rawText: "retry result", formattedText: "retry result", language: "en" } satisfies TranscriptionResult);
    registryState.providers.set("groq", provider("groq", transcribe));
    const { TranscriptionService } = await import("@main/transcription");
    const service = new TranscriptionService(() => ({ ...DEFAULT_SETTINGS, groqApiKey: "groq-key" }));

    const result = await service.transcribe(clip, { recovery: true });

    expect(result.rawText).toBe("retry result");
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(result.providerAttempts?.map((attempt) => attempt.errorClass)).toEqual(["transient_network", undefined]);
  });

  it("fails over after the bounded recovery retry and records the full attempt sequence", async () => {
    const primary = vi.fn()
      .mockRejectedValueOnce(new Error("503 provider failure"))
      .mockRejectedValueOnce(new Error("503 provider failure"));
    const fallback = vi.fn(async (): Promise<TranscriptionResult> => ({ rawText: "local rescue", formattedText: "local rescue", language: "en" }));
    registryState.providers.set("openai", provider("openai", primary));
    registryState.providers.set("local-whisper", provider("local-whisper", fallback, false));
    const { TranscriptionService } = await import("@main/transcription");
    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      transcriptionProvider: "openai",
      providerApiKeys: [{ providerId: "openai", key: "openai-key" }],
      failoverEnabled: true,
    }));

    const result = await service.transcribe(clip, { recovery: true });

    expect(result.rawText).toBe("local rescue");
    expect(primary).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(result.providerAttempts).toHaveLength(3);
    expect(result.providerAttempts?.map((attempt) => attempt.provider)).toEqual(["openai", "openai", "local-whisper"]);
  });

  it.each([
    "401 Unauthorized",
    "malformed audio payload",
  ] as const)("does not retry permanent recovery error %s", async (message) => {
    const transcribe = vi.fn(async () => { throw new Error(message); });
    registryState.providers.set("groq", provider("groq", transcribe));
    const { TranscriptionService } = await import("@main/transcription");
    const service = new TranscriptionService(() => ({ ...DEFAULT_SETTINGS, groqApiKey: "groq-key" }));

    await expect(service.transcribe(clip, { recovery: true })).rejects.toThrow(message);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("checks cancellation at the local Whisper boundary", async () => {
    const controller = new AbortController();
    controller.abort();
    const { LocalWhisperProvider } = await import("@main/providers/local/whisperCpp");

    await expect(LocalWhisperProvider.transcribe(clip, { signal: controller.signal })).rejects.toThrow("aborted");
  });

  it("delivers cancellation to an in-flight provider and never starts another provider", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const transcribe = vi.fn((_clip: AudioClip, options: Parameters<TranscriptionProvider["transcribe"]>[1]) => {
      receivedSignal = options.signal;
      return new Promise<TranscriptionResult>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    });
    const fallback = vi.fn();
    registryState.providers.set("groq", provider("groq", transcribe));
    registryState.providers.set("openai", provider("openai", fallback));
    const { TranscriptionCancelledError, TranscriptionService } = await import("@main/transcription");
    const service = new TranscriptionService(() => ({ ...DEFAULT_SETTINGS, groqApiKey: "groq-key", failoverEnabled: true, providerApiKeys: [{ providerId: "openai", key: "openai-key" }] }));

    const pending = service.transcribe(clip, { signal: controller.signal, recovery: true });
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(TranscriptionCancelledError);
    expect(receivedSignal?.aborted).toBe(true);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("passes one cancellation signal through every long-clip chunk", async () => {
    const signals: AbortSignal[] = [];
    const transcribe = vi.fn(async (_clip: AudioClip, options: Parameters<TranscriptionProvider["transcribe"]>[1]): Promise<TranscriptionResult> => {
      if (options.signal) signals.push(options.signal);
      return { rawText: "chunk", formattedText: "chunk", language: "en" };
    });
    registryState.providers.set("groq", provider("groq", transcribe));
    const { TranscriptionService } = await import("@main/transcription");
    const service = new TranscriptionService(() => ({ ...DEFAULT_SETTINGS, groqApiKey: "groq-key" }));
    const longClip: AudioClip = { pcmData: new Array(61 * 16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 61, rmsFrames: [] };

    await service.transcribe(longClip, { recovery: true });

    expect(signals.length).toBe(3);
    expect(new Set(signals).size).toBe(1);
  });

  it("passes cancellation through recovery formatting blocks", async () => {
    let receivedSignal: AbortSignal | undefined;
    const controller = new AbortController();
    registryState.formattingProviders.set("groq-llm", formattingProvider("groq-llm", vi.fn(async (_text: string, options) => {
      receivedSignal = options.signal;
      return new Promise<string>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    })));
    const { TranscriptionService } = await import("@main/transcription");
    const service = new TranscriptionService(() => ({ ...DEFAULT_SETTINGS, groqApiKey: "groq-key" }));

    const pending = service.formatTranscriptDetailed("alpha beta", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("Transcription was cancelled.");
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("lets active dictation preempt background recovery before a provider call", async () => {
    const transcribe = vi.fn();
    registryState.providers.set("groq", provider("groq", transcribe));
    const { RecoveryYieldedError, TranscriptionService } = await import("@main/transcription");
    const service = new TranscriptionService(() => ({ ...DEFAULT_SETTINGS, groqApiKey: "groq-key" }));

    await expect(service.transcribe(clip, { recovery: true, shouldYieldToActiveDictation: () => true })).rejects.toBeInstanceOf(RecoveryYieldedError);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("clears deadline timers when a cancellation scope is disposed", () => {
    vi.useFakeTimers();
    try {
      const scope = createCancellationScope(undefined, Date.now() + 1000);
      scope.dispose();
      vi.advanceTimersByTime(1000);
      expect(scope.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
