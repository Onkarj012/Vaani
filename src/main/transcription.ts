import { captureSessionSettings, restoreSessionSettings, type SessionSettingsSnapshot } from "@shared/sessionSettings";
import type { DictationContentGuardVerdict, DictationFormatterUsed, ProviderAttemptTrace, Settings, AudioClip, TranscriptionResult } from "@shared/types";
import type { RecoveryErrorClass } from "@shared/recovery";
import { getProviderRegistry } from "./providers";
import type { FormattingProvider, TranscriptionProvider } from "./providers/types";
import { CredentialsStore } from "./store/credentials";
import { debug, warn } from "@main/log";
import { missingContentWords, preservesFinalWords } from "@shared/contentGuard";
import { createCancellationScope, isAbortError, throwIfAborted } from "@main/cancellation";
import { deterministicFormat } from "@main/text/cleanup";

export const MAX_SINGLE_STT_CLIP_SECONDS = 30;
const STT_CHUNK_OVERLAP_SECONDS = 2;
const TRANSCRIPTION_BASE_TIMEOUT_MS = 30_000;
const TRANSCRIPTION_PER_ADDITIONAL_CHUNK_TIMEOUT_MS = 10_000;
export const MAX_TRANSCRIPTION_TIMEOUT_MS = 300_000;
const LOW_LOGPROB_THRESHOLD = -1.2;

const STRONGER_STT_MODELS: Record<string, string> = {
  groq: "whisper-large-v3",
};

export interface TranscriptionAttempt {
  clip: AudioClip;
  model: string;
}

export interface FormattingOptions {
  signal?: AbortSignal;
  deadlineAt?: number;
  sessionSettings?: SessionSettingsSnapshot;
}

export interface TranscribeOptions {
  sessionSettings?: SessionSettingsSnapshot;
  speechContext?: { trimmedDurationSeconds: number; speechGatePassed: boolean };
  languageOverride?: string;
  providerOverride?: string;
  rejectResult?: (result: TranscriptionResult) => boolean;
  retryClip?: AudioClip;
  deadlineAt?: number;
  signal?: AbortSignal;
  recovery?: boolean;
  shouldYieldToActiveDictation?: () => boolean;
}

export function getTranscriptionTimeoutMs(durationSeconds: number): number {
  const expectedChunkCount = Math.max(1, Math.ceil(Math.max(0, durationSeconds) / MAX_SINGLE_STT_CLIP_SECONDS));
  return Math.min(
    MAX_TRANSCRIPTION_TIMEOUT_MS,
    TRANSCRIPTION_BASE_TIMEOUT_MS + (expectedChunkCount - 1) * TRANSCRIPTION_PER_ADDITIONAL_CHUNK_TIMEOUT_MS,
  );
}

export class TranscriptionDeadlineExceededError extends Error {
  readonly providerAttempts: ProviderAttemptTrace[];

  constructor(providerAttempts: ProviderAttemptTrace[] = []) {
    super("Transcription deadline exceeded.");
    this.name = "TranscriptionDeadlineExceededError";
    this.providerAttempts = providerAttempts;
  }
}

export class TranscriptionCancelledError extends Error {
  readonly providerAttempts: ProviderAttemptTrace[];

  constructor(providerAttempts: ProviderAttemptTrace[] = []) {
    super("Transcription was cancelled.");
    this.name = "TranscriptionCancelledError";
    this.providerAttempts = providerAttempts;
  }
}

export class RecoveryYieldedError extends Error {
  constructor() {
    super("Background recovery yielded to active dictation.");
    this.name = "RecoveryYieldedError";
  }
}

export class TranscriptionChainError extends Error {
  readonly providerAttempts: ProviderAttemptTrace[];
  readonly errorClass: RecoveryErrorClass;

  constructor(message: string, providerAttempts: ProviderAttemptTrace[], errorClass: RecoveryErrorClass = "transcription_error") {
    super(message);
    this.name = "TranscriptionChainError";
    this.providerAttempts = providerAttempts;
    this.errorClass = errorClass;
  }
}

function throwIfTranscriptionDeadlineExceeded(deadlineAt?: number, signal?: AbortSignal): void {
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
    throw new TranscriptionDeadlineExceededError();
  }
  throwIfAborted(signal);
}

export interface FormatTranscriptTraceResult {
  text: string;
  formatterUsed: DictationFormatterUsed;
  contentGuardVerdict?: DictationContentGuardVerdict;
}

export class TranscriptionService {
  constructor(
    private readonly settingsProvider: () => Settings,
    private readonly credentials?: CredentialsStore
  ) {}

  async transcribe(clip: AudioClip, options?: TranscribeOptions): Promise<TranscriptionResult> {
    const scope = createCancellationScope(options?.signal, options?.deadlineAt);
    try {
      const settings = restoreSessionSettings(options?.sessionSettings ?? captureSessionSettings(this.settingsProvider()));
      const registry = getProviderRegistry();
      const primaryId = options?.providerOverride || settings.transcriptionProvider || "groq";
      if ((primaryId === "local-whisper" || settings.offlineMode === "always-offline") &&
          settings.localWhisperModel !== this.settingsProvider().localWhisperModel) {
        throw new Error(`Restore local model "${settings.localWhisperModel}" to retry this session, or start a new dictation.`);
      }
      const speechContextPrompt = buildSpeechContextPrompt(settings, options?.speechContext);
      const chain = await this.buildSttChain(settings, primaryId, registry);
      if (chain.length === 0) throw new Error(messageForEmptyChain(settings, primaryId));

      debug("transcription", `Chain: ${chain.map(c => c.id).join(" → ")}`);
      const language = options?.languageOverride ?? settings.language;
      let lastError: Error = new Error("All transcription providers failed.");
      let lastRejectedResult: TranscriptionResult | null = null;
      const providerAttempts: ProviderAttemptTrace[] = [];
      for (let providerIndex = 0; providerIndex < chain.length; providerIndex += 1) {
        const { id, provider, apiKey } = chain[providerIndex]!;
        const clips = options?.retryClip ? [clip, options.retryClip] : [clip];
        const attempts = buildTranscriptionAttempts(id, provider.models, clips, settings.transcriptionModel);
        if (options?.recovery) {
          const firstAttempt = attempts[0];
          attempts.splice(0, attempts.length, ...(firstAttempt ? [firstAttempt] : []));
        }
        for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
          if (options?.shouldYieldToActiveDictation?.()) throw new RecoveryYieldedError();
          const attempt = attempts[attemptIndex]!;
          const startedAt = Date.now();
          const startedAtIso = new Date(startedAt).toISOString();
          try {
            if (options?.deadlineAt !== undefined && Date.now() >= options.deadlineAt) {
              throw new TranscriptionDeadlineExceededError();
            }
            const result = await transcribePossiblyChunked(provider, attempt.clip, {
              apiKey,
              language,
              model: attempt.model || undefined,
              prompt: attempt.clip.durationSeconds >= 2 ? speechContextPrompt : undefined,
              temperature: 0,
              signal: scope.signal,
              recovery: options?.recovery,
            }, options?.deadlineAt, scope.signal, options?.shouldYieldToActiveDictation, () => {
              const current = this.settingsProvider();
              if ((id !== "local-whisper" && current.offlineMode === "always-offline") ||
                  (id === "local-whisper" && current.localWhisperModel !== settings.localWhisperModel)) {
                throw new TranscriptionCancelledError();
              }
            });
            throwIfTranscriptionDeadlineExceeded(options?.deadlineAt, scope.signal);
            const quality = {
              ...result.quality,
              provider: result.quality?.provider ?? id,
              attemptCount: providerAttempts.length + 1,
              supportsConfidence: result.quality?.supportsConfidence ?? false,
              transcriptLength: result.rawText.length,
            };
            const withQuality: TranscriptionResult = { ...result, quality };
            providerAttempts.push({
              provider: id,
              success: true,
              attempt: providerAttempts.length + 1,
              latencyMs: Date.now() - startedAt,
              quality,
              outcome: "succeeded",
              startedAt: startedAtIso,
              completedAt: new Date().toISOString(),
              deadlineAt: options?.deadlineAt ? new Date(options.deadlineAt).toISOString() : null,
            });
            const lowConfidence = quality.avgLogprob != null && quality.avgLogprob < LOW_LOGPROB_THRESHOLD;
            if (options?.rejectResult?.(withQuality) || lowConfidence) {
              lastRejectedResult = withQuality;
              if (attemptIndex < attempts.length - 1) {
                warn("transcription", `Provider "${id}" returned a low-confidence transcript; retrying transcription`);
                continue;
              }
              if (settings.failoverEnabled && providerIndex < chain.length - 1) {
                warn("transcription", `Provider "${id}" returned suspicious transcript; trying next provider`);
                break;
              }
            }
            return { ...withQuality, quality: { ...quality, attemptCount: providerAttempts.length }, providerAttempts };
          } catch (error) {
            const deadlineExceeded = options?.deadlineAt !== undefined && Date.now() >= options.deadlineAt;
            if (deadlineExceeded || error instanceof TranscriptionDeadlineExceededError) {
              providerAttempts.push({ provider: id, success: false, attempt: providerAttempts.length + 1, latencyMs: Date.now() - startedAt, error: "Transcription deadline exceeded.", outcome: "cancelled", errorClass: "timeout", startedAt: startedAtIso, completedAt: new Date().toISOString(), deadlineAt: options?.deadlineAt ? new Date(options.deadlineAt).toISOString() : null });
              throw new TranscriptionDeadlineExceededError(providerAttempts);
            }
            if (scope.signal.aborted || error instanceof TranscriptionCancelledError || isAbortError(error)) {
              providerAttempts.push({ provider: id, success: false, attempt: providerAttempts.length + 1, latencyMs: Date.now() - startedAt, error: "Transcription was cancelled.", outcome: "cancelled", errorClass: "aborted", startedAt: startedAtIso, completedAt: new Date().toISOString(), deadlineAt: options?.deadlineAt ? new Date(options.deadlineAt).toISOString() : null });
              throw new TranscriptionCancelledError(providerAttempts);
            }
            lastError = error instanceof Error ? error : new Error(String(error));
            const failure = classifyTranscriptionError(error);
            providerAttempts.push({ provider: id, success: false, attempt: providerAttempts.length + 1, latencyMs: Date.now() - startedAt, error: lastError.message, outcome: "failed", errorClass: failure.class, startedAt: startedAtIso, completedAt: new Date().toISOString(), deadlineAt: options?.deadlineAt ? new Date(options.deadlineAt).toISOString() : null });
            warn("transcription", `Provider "${id}" failed: ${lastError.message}`);
            if (options?.recovery) {
              if (failure.permanent) throw new TranscriptionChainError(lastError.message, providerAttempts, failure.class);
              if (failure.retryable && attemptIndex === 0) {
                attempts.push(attempt);
                continue;
              }
            } else if (isAuthError(error)) {
              throw lastError;
            }
            if (!settings.failoverEnabled || chain.length === 1) {
              throw options?.recovery ? new TranscriptionChainError(lastError.message, providerAttempts, providerAttempts[providerAttempts.length - 1]?.errorClass ?? "transcription_error") : lastError;
            }
            break;
          }
        }
      }

      if (lastRejectedResult) return { ...lastRejectedResult, providerAttempts };
      throw options?.recovery
        ? new TranscriptionChainError(lastError.message, providerAttempts, providerAttempts[providerAttempts.length - 1]?.errorClass ?? "transcription_error")
        : lastError;
    } finally {
      scope.dispose();
    }
  }

  private async buildSttChain(
    settings: Settings,
    primaryId: string,
    registry: ReturnType<typeof getProviderRegistry>
  ): Promise<{ id: string; provider: TranscriptionProvider; apiKey: string }[]> {
    const chain: { id: string; provider: TranscriptionProvider; apiKey: string }[] = [];
    const offlineMode = settings.offlineMode ?? "auto";

    const tryAdd = async (id: string) => {
      if (chain.some(e => e.id === id)) return;
      if (offlineMode === "always-offline" && id !== "local-whisper") return;
      if (offlineMode === "always-online" && id === "local-whisper") return;
      const provider = registry.getTranscription(id);
      if (!provider) {
        return;
      }
      const apiKey = await this.resolveApiKey(this.settingsProvider(), id);
      if (provider.requiresApiKey && !apiKey) {
        return;
      }
      if (id === "local-whisper" && !(await provider.isAvailable())) return;
      chain.push({ id, provider, apiKey: apiKey ?? "" });
    };

    if (offlineMode === "always-offline") {
      await tryAdd("local-whisper");
      return chain;
    }

    await tryAdd(primaryId);

    if (settings.failoverEnabled) {
      for (const fallbackId of ["groq", "openai", "deepgram", "local-whisper"]) {
        if (fallbackId !== primaryId) await tryAdd(fallbackId);
      }
    }

    return chain;
  }

  async formatTranscript(rawText: string, options?: FormattingOptions): Promise<string> {
    return (await this.formatTranscriptDetailed(rawText, options)).text;
  }

  async formatTranscriptDetailed(rawText: string, options?: FormattingOptions): Promise<FormatTranscriptTraceResult> {
    const scope = createCancellationScope(options?.signal, options?.deadlineAt);
    try {
      const settings = restoreSessionSettings(options?.sessionSettings ?? captureSessionSettings(this.settingsProvider()));
      // Offline policy covers the entire pipeline, including LLM formatting.
      // The current formatting registry contains remote providers only.
      if (settings.offlineMode === "always-offline" || this.settingsProvider().offlineMode === "always-offline") {
        throwIfTranscriptionDeadlineExceeded(options?.deadlineAt, scope.signal);
        return { text: rawText, formatterUsed: "none" };
      }
      const registry = getProviderRegistry();
      const llmId = settings.formattingProvider || "groq-llm";
      const provider = registry.getFormatting(llmId);
      if (!provider) return { text: rawText, formatterUsed: "none" };
      const configuredApiKey = configuredApiKeyFor(this.settingsProvider(), llmId);
      const apiKey = configuredApiKey ?? (this.credentials ? await this.resolveApiKey(this.settingsProvider(), llmId) : null);
      if (provider.requiresApiKey && !apiKey) return { text: rawText, formatterUsed: "none" };
      throwIfTranscriptionDeadlineExceeded(options?.deadlineAt, scope.signal);
      const result = await this.formatTranscriptBlocks(rawText, provider, apiKey ?? "", settings, scope.signal);
      throwIfTranscriptionDeadlineExceeded(options?.deadlineAt, scope.signal);
      return result;
    } catch (error) {
      if (options?.deadlineAt !== undefined && Date.now() >= options.deadlineAt) throw new TranscriptionDeadlineExceededError();
      if (scope.signal.aborted || isAbortError(error)) throw new TranscriptionCancelledError();
      return { text: rawText, formatterUsed: "none" };
    } finally {
      scope.dispose();
    }
  }

  private async formatTranscriptBlocks(
    rawText: string,
    provider: FormattingProvider,
    apiKey: string,
    settings: Settings,
    signal: AbortSignal,
  ): Promise<FormatTranscriptTraceResult> {
    if (!hasParagraphBreak(rawText)) {
      return this.formatTranscriptBlock(rawText, provider, apiKey, settings, signal);
    }

    const parts = splitParagraphParts(rawText);
    const formattedParts: string[] = [];
    const missingWords: string[] = [];
    let usedFormatter = false;
    let usedFallback = false;

    for (const part of parts) {
      if (part.type === "separator") {
        formattedParts.push(part.value);
        continue;
      }

      const text = part.value.trim();
      if (!text) continue;
      throwIfAborted(signal);
      const result = await this.formatTranscriptBlock(text, provider, apiKey, settings, signal);
      formattedParts.push(result.text.trim());
      if (result.formatterUsed === "llm") usedFormatter = true;
      if (result.formatterUsed === "guard-fallback") usedFallback = true;
      if (result.contentGuardVerdict?.missingWords) missingWords.push(...result.contentGuardVerdict.missingWords);
    }

    if (usedFallback) {
      return {
        text: formattedParts.join("").trim(),
        formatterUsed: "guard-fallback",
        contentGuardVerdict: { passed: false, missingWords },
      };
    }

    return {
      text: formattedParts.join("").trim(),
      formatterUsed: usedFormatter ? "llm" : "none",
      contentGuardVerdict: usedFormatter ? { passed: true } : undefined,
    };
  }

  private async formatTranscriptBlock(
    rawText: string,
    provider: FormattingProvider,
    apiKey: string,
    settings: Settings,
    signal: AbortSignal,
  ): Promise<FormatTranscriptTraceResult> {
    if (signal.aborted) throw new TranscriptionCancelledError();
    if (this.settingsProvider().offlineMode === "always-offline") return { text: rawText, formatterUsed: "none" };
    const formatted = await provider.format(rawText, {
      apiKey,
      model: settings.formattingModel,
      systemPrompt: settings.customPrompt,
      signal,
    });
    const missingWords = missingContentWords(rawText, formatted);
    if (missingWords.length > 0 || !preservesFinalWords(rawText, formatted)) {
      debug("transcription", "Content guard rejected LLM output — falling back to raw transcript cleanup");
      return {
        text: deterministicFormat(rawText),
        formatterUsed: "guard-fallback",
        contentGuardVerdict: { passed: false, missingWords },
      };
    }
    return {
      text: formatted,
      formatterUsed: "llm",
      contentGuardVerdict: { passed: true },
    };
  }

  private async resolveApiKey(settings: Settings, providerId: string): Promise<string | null> {
    const candidateIds = providerId === "groq-llm" ? ["groq-llm", "groq"] : [providerId];

    if (this.credentials) {
      for (const id of candidateIds) {
        const key = await this.credentials.get(id);
        if (key) return key;
      }
    }

    if ((providerId === "groq" || providerId === "groq-llm") && settings.groqApiKey) {
      return settings.groqApiKey;
    }

    const pk = settings.providerApiKeys?.find(p => p.providerId === providerId);
    if (pk?.key) return pk.key;

    return null;
  }
}

async function transcribePossiblyChunked(
  provider: TranscriptionProvider,
  clip: AudioClip,
  options: Parameters<TranscriptionProvider["transcribe"]>[1],
  deadlineAt?: number,
  signal?: AbortSignal,
  shouldYieldToActiveDictation?: () => boolean,
  beforeProviderCall?: () => void,
): Promise<TranscriptionResult> {
  if (clip.durationSeconds <= MAX_SINGLE_STT_CLIP_SECONDS) {
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      throw new TranscriptionDeadlineExceededError();
    }
    throwIfTranscriptionDeadlineExceeded(deadlineAt, signal);
    beforeProviderCall?.();
    const pending = provider.transcribe(clip, options);
    if (signal?.aborted) {
      void pending.catch(() => undefined);
      throw new TranscriptionCancelledError();
    }
    return pending;
  }

  const chunks = splitAudioClip(clip, MAX_SINGLE_STT_CLIP_SECONDS, STT_CHUNK_OVERLAP_SECONDS);
  debug("transcription", `Chunking long clip for STT: ${clip.durationSeconds.toFixed(2)}s into ${chunks.length} chunks`);
  const results: TranscriptionResult[] = [];
  for (const [index, chunk] of chunks.entries()) {
    if (shouldYieldToActiveDictation?.()) throw new RecoveryYieldedError();
    throwIfTranscriptionDeadlineExceeded(deadlineAt, signal);
    debug("transcription", `Transcribing chunk ${index + 1}/${chunks.length}: ${chunk.durationSeconds.toFixed(2)}s`);
    beforeProviderCall?.();
    results.push(await provider.transcribe(chunk, {
      ...options,
      prompt: chunk.durationSeconds >= 2 ? options.prompt : undefined,
    }));
  }

  return mergeChunkedTranscriptionResults(results, chunks);
}

export function buildTranscriptionAttempts(
  providerId: string,
  providerModels: TranscriptionProvider["models"],
  clips: AudioClip[],
  configuredModel: string,
): TranscriptionAttempt[] {
  const model = providerModels.some((candidate) => candidate.id === configuredModel) ? configuredModel : "";
  const attempts = clips.map((clip) => ({ clip, model }));
  const strongerModel = STRONGER_STT_MODELS[providerId];
  if (strongerModel && configuredModel !== strongerModel) {
    const firstClip = clips[0];
    if (firstClip) attempts.push({ clip: firstClip, model: strongerModel });
  }
  return attempts;
}

export function splitAudioClip(clip: AudioClip, maxDurationSeconds: number, overlapSeconds: number): AudioClip[] {
  const samplesPerChunk = Math.max(1, Math.floor(clip.sampleRate * maxDurationSeconds));
  const overlapSamples = Math.max(0, Math.min(samplesPerChunk - 1, Math.floor(clip.sampleRate * overlapSeconds)));
  const stepSamples = Math.max(1, samplesPerChunk - overlapSamples);
  const chunks: AudioClip[] = [];
  for (let start = 0; start < clip.pcmData.length; start += stepSamples) {
    const nominalEnd = Math.min(clip.pcmData.length, start + samplesPerChunk);
    const end = snapChunkEndToSilence(clip, start, nominalEnd);
    const pcmData = clip.pcmData.slice(start, end);
    chunks.push({
      pcmData,
      sampleRate: clip.sampleRate,
      durationSeconds: pcmData.length / clip.sampleRate,
      rmsFrames: sliceRmsFramesForSamples(clip, start, end),
    });
    if (end >= clip.pcmData.length) break;
  }
  return chunks.length > 0 ? chunks : [clip];
}

function snapChunkEndToSilence(clip: AudioClip, start: number, nominalEnd: number): number {
  if (clip.rmsFrames.length === 0 || nominalEnd >= clip.pcmData.length) return nominalEnd;

  const windowSamples = Math.floor(clip.sampleRate * 2);
  const windowStart = Math.max(start + 1, nominalEnd - windowSamples);
  const windowEnd = Math.min(clip.pcmData.length, nominalEnd + windowSamples);
  const framesPerSample = clip.rmsFrames.length / clip.pcmData.length;
  const firstFrame = Math.max(0, Math.floor(windowStart * framesPerSample));
  const lastFrame = Math.min(clip.rmsFrames.length - 1, Math.ceil(windowEnd * framesPerSample) - 1);
  if (firstFrame > lastFrame) return nominalEnd;

  let minimumFrame = firstFrame;
  for (let frame = firstFrame + 1; frame <= lastFrame; frame += 1) {
    if (clip.rmsFrames[frame]! < clip.rmsFrames[minimumFrame]!) minimumFrame = frame;
  }

  const snappedEnd = Math.round((minimumFrame + 0.5) / framesPerSample);
  return snappedEnd > start ? Math.min(snappedEnd, clip.pcmData.length) : nominalEnd;
}

function sliceRmsFramesForSamples(clip: AudioClip, startSample: number, endSample: number): number[] {
  if (clip.rmsFrames.length === 0 || clip.pcmData.length === 0) return [];
  const framesPerSample = clip.rmsFrames.length / clip.pcmData.length;
  const startFrame = Math.max(0, Math.floor(startSample * framesPerSample));
  const endFrame = Math.min(clip.rmsFrames.length, Math.ceil(endSample * framesPerSample));
  return clip.rmsFrames.slice(startFrame, endFrame);
}

function mergeChunkedTranscriptionResults(results: TranscriptionResult[], chunks: AudioClip[]): TranscriptionResult {
  const first = results[0];
  if (!first) {
    return { rawText: "", formattedText: "", language: null };
  }

  const rawText = mergeTranscriptParts(results.map(result => result.rawText));
  const qualities = results.map(result => result.quality).filter((quality): quality is NonNullable<TranscriptionResult["quality"]> => !!quality);
  const segmentCount = qualities.reduce((sum, quality) => sum + (quality.segmentCount ?? 0), 0);
  return {
    ...first,
    rawText,
    formattedText: rawText,
    detectedLanguage: first.detectedLanguage ?? results.find(result => result.detectedLanguage)?.detectedLanguage ?? null,
    quality: qualities.length > 0
      ? {
        ...qualities[0]!,
        avgLogprob: averageNullable(qualities.map(quality => quality.avgLogprob)),
        compressionRatio: averageNullable(qualities.map(quality => quality.compressionRatio)),
        noSpeechProbability: maxNullable(qualities.map(quality => quality.noSpeechProbability)),
        segmentCount: segmentCount > 0 ? segmentCount : undefined,
        transcriptLength: rawText.length,
        chunkCount: chunks.length,
        chunkDurationsSeconds: chunks.map(chunk => Number(chunk.durationSeconds.toFixed(3))),
        chunkOverlapSeconds: STT_CHUNK_OVERLAP_SECONDS,
      }
      : first.quality,
  };
}

function mergeTranscriptParts(parts: string[]): string {
  return parts
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((merged, part) => mergeTranscriptPair(merged, part), "")
    .trim();
}

function mergeTranscriptPair(left: string, right: string): string {
  if (!left) return right;
  const leftWords = normalizedWords(left);
  const rightWords = normalizedWords(right);
  const maxOverlap = Math.min(30, leftWords.length, rightWords.length);
  for (let count = maxOverlap; count >= 3; count -= 1) {
    const leftTail = leftWords.slice(leftWords.length - count).join(" ");
    const rightHead = rightWords.slice(0, count).join(" ");
    if (leftTail === rightHead) {
      return joinTranscriptText(left, dropFirstWords(right, count));
    }
  }
  return joinTranscriptText(left, right);
}

function joinTranscriptText(left: string, right: string): string {
  const trimmedLeft = left.trim();
  const trimmedRight = right.trim();
  if (!trimmedLeft) return trimmedRight;
  if (!trimmedRight) return trimmedLeft;
  if (/^[,.;:!?]/.test(trimmedRight)) return `${trimmedLeft}${trimmedRight}`;
  return `${trimmedLeft} ${trimmedRight}`;
}

function normalizedWords(text: string): string[] {
  return text
    .toLowerCase()
    .match(/[a-z0-9']+/g) ?? [];
}

function dropFirstWords(text: string, count: number): string {
  let seen = 0;
  for (const match of text.matchAll(/[a-z0-9']+/gi)) {
    seen += 1;
    if (seen === count) {
      return text.slice((match.index ?? 0) + match[0].length).trimStart();
    }
  }
  return "";
}

function averageNullable(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function maxNullable(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finite.length === 0) return null;
  return Math.max(...finite);
}

function messageForEmptyChain(settings: Settings, primaryId: string): string {
  if (settings.offlineMode === "always-offline") {
    return "Offline mode is enabled, but Local Whisper is not available. Go to Settings → Offline Mode to download or load a model.";
  }
  return `Transcription provider "${primaryId}" is not available or has no API key configured. Check Settings → API & Providers.`;
}

function isAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("authentication") || msg.includes("invalid api key") || msg.includes("incorrect api key");
}

export function classifyTranscriptionError(error: unknown): { class: RecoveryErrorClass; retryable: boolean; permanent: boolean } {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const statusMatch = message.match(/\b(4\d\d|5\d\d)\b/);
  const objectStatus = isRecord(error) && typeof error.status === "number" ? error.status : null;
  const status = objectStatus ?? (statusMatch ? Number(statusMatch[1]) : null);
  if (isAuthError(error)) return { class: "authentication", retryable: false, permanent: true };
  if (message.includes("permission") || message.includes("access denied")) return { class: "permission_denied", retryable: false, permanent: true };
  if ((message.includes("invalid") || message.includes("required") || message.includes("not configured")) && (message.includes("config") || message.includes("base url") || message.includes("model") || message.includes("api key"))) return { class: "invalid_config", retryable: false, permanent: true };
  if (message.includes("malformed") || message.includes("invalid audio") || message.includes("unsupported audio")) return { class: "malformed_audio", retryable: false, permanent: true };
  if (status === 429 || message.includes("rate limit") || message.includes("too many requests")) return { class: "rate_limit", retryable: true, permanent: false };
  if ((status !== null && status >= 500) || message.includes("temporarily unavailable") || message.includes("service unavailable")) return { class: "provider_5xx", retryable: true, permanent: false };
  if (message.includes("network") || message.includes("fetch failed") || message.includes("econn") || message.includes("timeout") || message.includes("temporar")) return { class: "transient_network", retryable: true, permanent: false };
  return { class: "transcription_error", retryable: false, permanent: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function configuredApiKeyFor(settings: Settings, providerId: string): string | null {
  if ((providerId === "groq" || providerId === "groq-llm") && settings.groqApiKey) return settings.groqApiKey;
  const providerKey = settings.providerApiKeys?.find((candidate) => candidate.providerId === providerId)?.key;
  return providerKey || null;
}

function hasParagraphBreak(text: string): boolean {
  return /\r?\n[ \t]*\r?\n/.test(text);
}

function splitParagraphParts(text: string): Array<{ type: "text" | "separator"; value: string }> {
  return text
    .split(/(\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*)/g)
    .filter(part => part.length > 0)
    .map(part => hasParagraphBreak(part)
      ? { type: "separator" as const, value: normalizeParagraphSeparator(part) }
      : { type: "text" as const, value: part });
}

function normalizeParagraphSeparator(separator: string): string {
  const newlineCount = separator.match(/\r?\n/g)?.length ?? 2;
  return "\n".repeat(Math.max(2, newlineCount));
}

const MAX_SPEECH_CONTEXT_CHARS = 600;
const MAX_SPEECH_CONTEXT_ITEMS = 24;

export function buildSpeechContextPrompt(
  settings: Pick<Settings, "customCorrections">,
  speechContext?: { trimmedDurationSeconds: number; speechGatePassed: boolean },
): string | undefined {
  if (!speechContext?.speechGatePassed || !(speechContext.trimmedDurationSeconds >= 2)) return undefined;
  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined) => {
    const term = normalizeSpeechContextTerm(value);
    if (!term) return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(term);
  };

  for (const correction of settings.customCorrections ?? []) {
    add(correction.written);
  }

  let prompt = "";
  for (const term of terms.slice(0, MAX_SPEECH_CONTEXT_ITEMS)) {
    const next = prompt ? `${prompt}, ${term}` : term;
    if (next.length > MAX_SPEECH_CONTEXT_CHARS) break;
    prompt = next;
  }

  return prompt || undefined;
}

function normalizeSpeechContextTerm(value: string | undefined): string | null {
  const term = value?.replace(/\s+/g, " ").trim();
  if (!term || term.length < 2 || term.length > 40) return null;
  if (/\d/.test(term)) return null;
  if (term.split(/\s+/).length > 3) return null;
  return term;
}

// Re-export for backward compatibility
export { formatTranscript } from "./formatting";
