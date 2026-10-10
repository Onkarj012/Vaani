import { captureSessionSettings, restoreSessionSettings, type SessionSettingsSnapshot } from "@shared/sessionSettings";
import type { DictationContentGuardVerdict, DictationFormatterStatus, DictationFormatterUsed, ProviderAttemptTrace, Settings, AudioClip, TranscriptionResult } from "@shared/types";
import type { RecoveryErrorClass } from "@shared/recovery";
import { getProviderRegistry } from "./providers";
import { defaultModelFor } from "@shared/modelList";
import type { FormattingProvider, TranscriptionProvider } from "./providers/types";
import { formatterErrorReason } from "./providers/types";
import { CHANGED_WORDS_REASON, EMPTY_REPLY_REASON, NO_API_KEY_REASON, NO_PROVIDER_REASON, OFFLINE_REASON } from "./providers/formatting-constants";
import { CredentialsStore } from "./store/credentials";
import { debug, warn } from "@main/log";
import { diffContentWords, stripReasoningBlocks } from "@shared/contentGuard";
import { createCancellationScope, isAbortError, throwIfAborted } from "@main/cancellation";
import { activeFillerWords } from "./text/cleanup";

export const MAX_SINGLE_STT_CLIP_SECONDS = 30;
const STT_CHUNK_OVERLAP_SECONDS = 2;
const TRANSCRIPTION_BASE_TIMEOUT_MS = 30_000;
const TRANSCRIPTION_PER_ADDITIONAL_CHUNK_TIMEOUT_MS = 10_000;
export const MAX_TRANSCRIPTION_TIMEOUT_MS = 300_000;
const LOW_LOGPROB_THRESHOLD = -1.2;
// Time kept back from the deadline so a fallback provider still gets to run.
const FALLBACK_RESERVE_MS = 10_000;

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

export function getTranscriptionTimeoutMs(clip: AudioClip): number {
  const chunkSize = Math.max(1, Math.floor(clip.sampleRate * MAX_SINGLE_STT_CLIP_SECONDS));
  const overlap = Math.max(0, Math.min(chunkSize - 1, Math.floor(clip.sampleRate * STT_CHUNK_OVERLAP_SECONDS)));
  const step = Math.max(1, chunkSize - overlap);
  let expectedChunkCount = 0;
  for (let start = 0; start < clip.pcmData.length; start += step) {
    expectedChunkCount += 1;
    if (snapChunkEndToSilence(clip, start, Math.min(clip.pcmData.length, start + chunkSize)) >= clip.pcmData.length) break;
  }
  expectedChunkCount = Math.max(1, expectedChunkCount);
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

// Deadline for a provider that has a fallback after it. Keeps FALLBACK_RESERVE_MS, but never less than half the time left.
function reserveFallbackDeadline(deadlineAt: number | undefined): number | undefined {
  if (deadlineAt === undefined) return undefined;
  const now = Date.now();
  return Math.max(deadlineAt - FALLBACK_RESERVE_MS, now + (deadlineAt - now) / 2);
}

export interface FormatTranscriptTraceResult {
  text: string;
  formatterUsed: DictationFormatterUsed;
  formatterStatus?: DictationFormatterStatus;
  formatterStatusReason?: string;
  contentGuardVerdict?: DictationContentGuardVerdict;
}

// Result for a formatter call that did not run, so the text stays as it was.
function skippedFormat(text: string, reason: string): FormatTranscriptTraceResult {
  return { text, formatterUsed: "none", formatterStatus: "skipped", formatterStatusReason: reason };
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
      if (options?.recovery && (primaryId === "local-whisper" || settings.offlineMode === "always-offline") &&
          settings.localWhisperModel !== this.settingsProvider().localWhisperModel) {
        throw new Error(`Restore local model "${settings.localWhisperModel}" to retry this session, or start a new dictation.`);
      }
      const speechContextPrompt = buildSpeechContextPrompt(settings, options?.speechContext);
      // Hints go on every clip, short ones included. The Groq prompt still needs a passed speech gate.
      const vocabularyHints = buildVocabularyTerms(settings);
      const { chain, skipReasons } = await this.buildSttChain(settings, primaryId, registry);
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
        // Why this provider runs: the primary was skipped, or the previous provider failed or was rejected.
        const providerFallbackReason = providerIndex === 0
          ? (id === primaryId ? undefined : skipReasons.get(primaryId))
          : (providerAttempts[providerAttempts.length - 1]?.error ?? "The previous provider returned a suspicious transcript.");
        const providerDeadlineAt = providerIndex < chain.length - 1 ? reserveFallbackDeadline(options?.deadlineAt) : options?.deadlineAt;
        for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
          if (options?.shouldYieldToActiveDictation?.()) throw new RecoveryYieldedError();
          const attempt = attempts[attemptIndex]!;
          const startedAt = Date.now();
          const startedAtIso = new Date(startedAt).toISOString();
          const model = id === "local-whisper" ? settings.localWhisperModel : attempt.model || undefined;
          // Fields every attempt record shares. The fallback reason belongs to the provider's first attempt only.
          const traceFields = {
            model: model ?? (defaultModelFor("transcription", id) || undefined),
            fallbackReason: attemptIndex === 0 ? providerFallbackReason : undefined,
          };
          const providerScope = createCancellationScope(scope.signal, providerDeadlineAt);
          try {
            if (options?.deadlineAt !== undefined && Date.now() >= options.deadlineAt) {
              throw new TranscriptionDeadlineExceededError();
            }
            const result = await transcribePossiblyChunked(provider, attempt.clip, {
              apiKey,
              language,
              model,
              prompt: speechContextPrompt,
              vocabularyHints,
              temperature: 0,
              signal: providerScope.signal,
              recovery: options?.recovery,
            }, options?.deadlineAt, providerScope.signal, options?.shouldYieldToActiveDictation, () => {
              const current = this.settingsProvider();
              if (options?.recovery && ((id !== "local-whisper" && current.offlineMode === "always-offline") ||
                  (id === "local-whisper" && current.localWhisperModel !== settings.localWhisperModel))) {
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
              ...traceFields,
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
            // The provider's own deadline fired, so this is a timeout the chain can fall back from.
            const providerTimedOut = providerScope.signal.aborted && !scope.signal.aborted;
            const deadlineExceeded = options?.deadlineAt !== undefined && Date.now() >= options.deadlineAt;
            if (deadlineExceeded || error instanceof TranscriptionDeadlineExceededError) {
              providerAttempts.push({ ...traceFields, provider: id, success: false, attempt: providerAttempts.length + 1, latencyMs: Date.now() - startedAt, error: "Transcription deadline exceeded.", outcome: "cancelled", errorClass: "timeout", startedAt: startedAtIso, completedAt: new Date().toISOString(), deadlineAt: options?.deadlineAt ? new Date(options.deadlineAt).toISOString() : null });
              throw new TranscriptionDeadlineExceededError(providerAttempts);
            }
            if (scope.signal.aborted || (!providerTimedOut && (error instanceof TranscriptionCancelledError || isAbortError(error)))) {
              providerAttempts.push({ ...traceFields, provider: id, success: false, attempt: providerAttempts.length + 1, latencyMs: Date.now() - startedAt, error: "Transcription was cancelled.", outcome: "cancelled", errorClass: "aborted", startedAt: startedAtIso, completedAt: new Date().toISOString(), deadlineAt: options?.deadlineAt ? new Date(options.deadlineAt).toISOString() : null });
              throw new TranscriptionCancelledError(providerAttempts);
            }
            lastError = providerTimedOut ? new Error("Request timed out.") : error instanceof Error ? error : new Error(String(error));
            const failure = providerTimedOut ? { class: "timeout" as const, retryable: false, permanent: false } : classifyTranscriptionError(error);
            providerAttempts.push({ ...traceFields, provider: id, success: false, attempt: providerAttempts.length + 1, latencyMs: Date.now() - startedAt, error: lastError.message, outcome: "failed", errorClass: failure.class, startedAt: startedAtIso, completedAt: new Date().toISOString(), deadlineAt: options?.deadlineAt ? new Date(options.deadlineAt).toISOString() : null });
            warn("transcription", `Provider "${id}" failed: ${lastError.message}`);
            if (options?.recovery) {
              if (failure.permanent) throw new TranscriptionChainError(lastError.message, providerAttempts, failure.class);
              if (failure.retryable && attemptIndex === 0) {
                attempts.push(attempt);
                continue;
              }
            } else if (isAuthError(error) && id !== "openrouter") {
              // A rejected OpenRouter key falls back to Groq, so a revoked key does not stop dictation.
              throw lastError;
            }
            if (!settings.failoverEnabled || chain.length === 1) {
              throw options?.recovery ? new TranscriptionChainError(lastError.message, providerAttempts, providerAttempts[providerAttempts.length - 1]?.errorClass ?? "transcription_error") : lastError;
            }
            break;
          } finally {
            providerScope.dispose();
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
  ): Promise<{ chain: { id: string; provider: TranscriptionProvider; apiKey: string }[]; skipReasons: Map<string, string> }> {
    const chain: { id: string; provider: TranscriptionProvider; apiKey: string }[] = [];
    const skipReasons = new Map<string, string>();
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
        skipReasons.set(id, `No API key saved for "${id}".`);
        return;
      }
      if (id === "local-whisper" && !(await provider.isAvailable())) return;
      chain.push({ id, provider, apiKey: apiKey ?? "" });
    };

    if (offlineMode === "always-offline") {
      await tryAdd("local-whisper");
      return { chain, skipReasons };
    }

    await tryAdd(primaryId);

    if (settings.failoverEnabled) {
      // OpenRouter falls back only to Groq direct. Other primaries keep the older chain.
      const fallbackIds = primaryId === "openrouter" ? ["groq"] : ["groq", "openai", "deepgram"];
      for (const fallbackId of fallbackIds) {
        if (fallbackId !== primaryId) await tryAdd(fallbackId);
      }
    }

    return { chain, skipReasons };
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
        return skippedFormat(rawText, OFFLINE_REASON);
      }
      const registry = getProviderRegistry();
      const llmId = settings.formattingProvider || "groq-llm";
      const provider = registry.getFormatting(llmId);
      if (!provider) return skippedFormat(rawText, NO_PROVIDER_REASON);
      const configuredApiKey = configuredApiKeyFor(this.settingsProvider(), llmId);
      const apiKey = configuredApiKey ?? (this.credentials ? await this.resolveApiKey(this.settingsProvider(), llmId) : null);
      if (provider.requiresApiKey && !apiKey) return skippedFormat(rawText, NO_API_KEY_REASON);
      throwIfTranscriptionDeadlineExceeded(options?.deadlineAt, scope.signal);
      const result = await this.formatTranscriptBlocks(rawText, provider, apiKey ?? "", settings, scope.signal);
      throwIfTranscriptionDeadlineExceeded(options?.deadlineAt, scope.signal);
      return result;
    } catch (error) {
      if (options?.deadlineAt !== undefined && Date.now() >= options.deadlineAt) throw new TranscriptionDeadlineExceededError();
      if (scope.signal.aborted || isAbortError(error)) throw new TranscriptionCancelledError();
      return { text: rawText, formatterUsed: "none", formatterStatus: "failed", formatterStatusReason: formatterErrorReason(error) };
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
    const blockResults: FormatTranscriptTraceResult[] = [];

    for (const part of parts) {
      if (part.type === "separator") {
        formattedParts.push(part.value);
        continue;
      }

      const text = part.value.trim();
      if (!text) continue;
      throwIfAborted(signal);
      const result = await this.formatTranscriptBlock(text, provider, apiKey, settings, signal);
      blockResults.push(result);
      formattedParts.push(result.text.trim());
      if (result.contentGuardVerdict?.missingWords) missingWords.push(...result.contentGuardVerdict.missingWords);
    }

    const usedFallback = blockResults.some(r => r.formatterUsed === "guard-fallback");
    // A failed or rejected block sets the trace status, so one bad paragraph is never hidden behind a good one.
    const summary = blockResults.find(r => r.formatterStatus === "failed" || r.formatterStatus === "rejected")
      ?? blockResults.find(r => r.formatterUsed === "llm")
      ?? blockResults[0];
    // Only a ran aggregate counts as LLM output; a failed or rejected paragraph makes the whole result unformatted.
    const aggregateRan = summary?.formatterStatus === "ran";
    const text = formattedParts.join("").trim();

    if (usedFallback) {
      return {
        text,
        formatterUsed: "guard-fallback",
        formatterStatus: summary?.formatterStatus,
        formatterStatusReason: summary?.formatterStatusReason,
        contentGuardVerdict: { passed: false, missingWords },
      };
    }

    return {
      text,
      formatterUsed: aggregateRan ? "llm" : "none",
      formatterStatus: summary?.formatterStatus,
      formatterStatusReason: summary?.formatterStatusReason,
      contentGuardVerdict: aggregateRan ? { passed: true } : undefined,
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
    if (this.settingsProvider().offlineMode === "always-offline") return skippedFormat(rawText, OFFLINE_REASON);
    const fillerWords = activeFillerWords(settings);
    const result = await provider.format(rawText, {
      apiKey,
      model: settings.formattingModel,
      systemPrompt: settings.customPrompt,
      signal,
      fillerWords,
    });
    if (result.status !== "ran") {
      return { text: result.text, formatterUsed: "none", formatterStatus: result.status, formatterStatusReason: result.reason };
    }
    const formatted = stripReasoningBlocks(result.text);
    if (!formatted) {
      return { text: rawText, formatterUsed: "none", formatterStatus: "failed", formatterStatusReason: EMPTY_REPLY_REASON };
    }
    const { missing, added } = diffContentWords(rawText, formatted, fillerWords);
    if (missing.length > 0 || added.length > 0) {
      debug("transcription", "Content guard rejected LLM output — falling back to raw transcript cleanup");
      return {
        text: rawText,
        formatterUsed: "guard-fallback",
        formatterStatus: "rejected",
        formatterStatusReason: CHANGED_WORDS_REASON,
        contentGuardVerdict: { passed: false, missingWords: missing },
      };
    }
    return {
      text: formatted,
      formatterUsed: "llm",
      formatterStatus: "ran",
      formatterStatusReason: result.reason,
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
    results.push(await provider.transcribe(chunk, options));
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
  if (!speechContext?.speechGatePassed) return undefined;
  return buildVocabularyTerms(settings).join(", ") || undefined;
}

// Enabled dictionary spellings, used as vocabulary hints on every clip, short ones included.
export function buildVocabularyTerms(settings: Pick<Settings, "customCorrections">): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const correction of settings.customCorrections ?? []) {
    if (correction.enabled === false) continue;
    const term = normalizeSpeechContextTerm(correction.written);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }

  const capped: string[] = [];
  let length = 0;
  for (const term of terms.slice(0, MAX_SPEECH_CONTEXT_ITEMS)) {
    const nextLength = length === 0 ? term.length : length + ", ".length + term.length;
    if (nextLength > MAX_SPEECH_CONTEXT_CHARS) break;
    capped.push(term);
    length = nextLength;
  }
  return capped;
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
