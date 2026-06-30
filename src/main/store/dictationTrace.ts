import { app } from "electron";
import { join } from "node:path";
import { APP_DATA_DIR, HISTORY_LIMIT } from "@shared/defaults";
import type { DictationTrace } from "@shared/types";
import { readJsonFile, writeJsonFile } from "./base";

export class DictationTraceStore {
  private readonly filePath: string;
  private pendingMutation: Promise<void> = Promise.resolve();
  private cache: DictationTrace[] | null = null;

  constructor(filePath = join(app.getPath("home"), APP_DATA_DIR, "dictation-traces.json")) {
    this.filePath = filePath;
  }

  async getAll(): Promise<DictationTrace[]> {
    return (await this.ensureLoaded()).map(copyTrace);
  }

  async getById(id: string): Promise<DictationTrace | undefined> {
    const traces = await this.ensureLoaded();
    const found = traces.find((trace) => trace.id === id);
    return found ? copyTrace(found) : undefined;
  }

  async getBySessionId(sessionId: string): Promise<DictationTrace | undefined> {
    const traces = await this.ensureLoaded();
    const found = traces.find((trace) => trace.sessionId === sessionId);
    return found ? copyTrace(found) : undefined;
  }

  async upsert(trace: DictationTrace): Promise<void> {
    await this.enqueueMutation(async () => {
      const traces = await this.ensureLoaded();
      const index = traces.findIndex((existing) => existing.id === trace.id);
      const nextTrace = copyTrace(trace);
      const next = index >= 0
        ? traces.map((existing, i) => i === index ? nextTrace : existing)
        : [nextTrace, ...traces];
      await writeJsonFile(this.filePath, next.slice(0, HISTORY_LIMIT));
      this.cache = next.slice(0, HISTORY_LIMIT);
    });
  }

  async updateById(id: string, updater: (trace: DictationTrace) => DictationTrace): Promise<DictationTrace | undefined> {
    let updated: DictationTrace | undefined;
    await this.enqueueMutation(async () => {
      const traces = await this.ensureLoaded();
      const next = traces.map((trace) => {
        if (trace.id !== id) return trace;
        updated = updater(copyTrace(trace));
        return updated;
      });
      if (!updated) return;
      await writeJsonFile(this.filePath, next);
      this.cache = next;
    });
    return updated ? copyTrace(updated) : undefined;
  }

  private async ensureLoaded(): Promise<DictationTrace[]> {
    if (this.cache) return this.cache;
    const raw = await readJsonFile<unknown>(this.filePath, []);
    this.cache = normalizeTraces(raw);
    return this.cache;
  }

  private enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const run = this.pendingMutation.catch(() => undefined).then(operation);
    this.pendingMutation = run.catch(() => undefined);
    return run;
  }
}

function normalizeTraces(raw: unknown): DictationTrace[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : crypto.randomUUID(),
      sessionId: typeof item.sessionId === "string" ? item.sessionId : "",
      startedAt: typeof item.startedAt === "string" ? item.startedAt : new Date().toISOString(),
      completedAt: typeof item.completedAt === "string" ? item.completedAt : undefined,
      hotkeyReleasedAt: typeof item.hotkeyReleasedAt === "string" ? item.hotkeyReleasedAt : undefined,
      targetAppBundleId: typeof item.targetAppBundleId === "string" ? item.targetAppBundleId : null,
      targetAppName: typeof item.targetAppName === "string" ? item.targetAppName : null,
      rawAudio: normalizeAudioQuality(item.rawAudio),
      trimmedAudio: normalizeAudioQuality(item.trimmedAudio),
      rawAudioPath: typeof item.rawAudioPath === "string" ? item.rawAudioPath : null,
      sttProvider: typeof item.sttProvider === "string" ? item.sttProvider : null,
      sttLatencyMs: typeof item.sttLatencyMs === "number" ? item.sttLatencyMs : undefined,
      formattingLatencyMs: typeof item.formattingLatencyMs === "number" ? item.formattingLatencyMs : undefined,
      transcriptLength: typeof item.transcriptLength === "number" ? item.transcriptLength : undefined,
      quality: normalizeQuality(item.quality),
      qualityDecision: normalizeQualityDecision(item.qualityDecision),
      providerAttempts: normalizeProviderAttempts(item.providerAttempts),
      injectionAttempts: normalizeInjectionAttempts(item.injectionAttempts),
      injectionMethod: item.injectionMethod === "ax" || item.injectionMethod === "clipboard" ? item.injectionMethod : null,
      outcome: normalizeOutcome(item.outcome),
      rejectionReason: typeof item.rejectionReason === "string" ? item.rejectionReason as DictationTrace["rejectionReason"] : undefined,
      userMessage: typeof item.userMessage === "string" ? item.userMessage : undefined,
    }));
}

function normalizeAudioQuality(value: unknown): DictationTrace["rawAudio"] {
  if (!isObject(value)) return undefined;
  const durationSeconds = finiteNumber(value.durationSeconds);
  const sampleRate = finiteNumber(value.sampleRate);
  const sampleCount = finiteNumber(value.sampleCount);
  const rmsAverage = finiteNumber(value.rmsAverage);
  const rmsPeak = finiteNumber(value.rmsPeak);
  const peakAmplitude = finiteNumber(value.peakAmplitude);
  const clippingRatio = finiteNumber(value.clippingRatio);
  const silenceRatio = finiteNumber(value.silenceRatio);
  if (
    durationSeconds === undefined ||
    sampleRate === undefined ||
    sampleCount === undefined ||
    rmsAverage === undefined ||
    rmsPeak === undefined ||
    peakAmplitude === undefined ||
    clippingRatio === undefined ||
    silenceRatio === undefined
  ) return undefined;
  return { durationSeconds, sampleRate, sampleCount, rmsAverage, rmsPeak, peakAmplitude, clippingRatio, silenceRatio };
}

function normalizeQuality(value: unknown): DictationTrace["quality"] {
  if (!isObject(value)) return undefined;
  const provider = typeof value.provider === "string" ? value.provider : null;
  const attemptCount = finiteNumber(value.attemptCount);
  const transcriptLength = finiteNumber(value.transcriptLength);
  if (!provider || attemptCount === undefined || typeof value.supportsConfidence !== "boolean" || transcriptLength === undefined) {
    return undefined;
  }
  return {
    provider,
    attemptCount,
    supportsConfidence: value.supportsConfidence,
    confidence: nullableNumber(value.confidence),
    noSpeechProbability: nullableNumber(value.noSpeechProbability),
    avgLogprob: nullableNumber(value.avgLogprob),
    compressionRatio: nullableNumber(value.compressionRatio),
    segmentCount: finiteNumber(value.segmentCount),
    transcriptLength,
    decision: normalizeQualityDecision(value.decision),
  };
}

function normalizeQualityDecision(value: unknown): DictationTrace["qualityDecision"] {
  if (!isObject(value)) return undefined;
  if (!isTranscriptAction(value.action) || typeof value.reason !== "string") return undefined;
  return { action: value.action, reason: value.reason };
}

function normalizeProviderAttempts(value: unknown): DictationTrace["providerAttempts"] {
  if (!Array.isArray(value)) return undefined;
  const attempts: NonNullable<DictationTrace["providerAttempts"]> = [];
  for (const item of value) {
    if (!isObject(item) || typeof item.provider !== "string" || typeof item.success !== "boolean") continue;
    const attempt: NonNullable<DictationTrace["providerAttempts"]>[number] = {
      provider: item.provider,
      success: item.success,
    };
    const latencyMs = finiteNumber(item.latencyMs);
    const quality = normalizeQuality(item.quality);
    if (latencyMs !== undefined) attempt.latencyMs = latencyMs;
    if (typeof item.error === "string") attempt.error = item.error;
    if (quality) attempt.quality = quality;
    attempts.push(attempt);
  }
  return attempts.length > 0 ? attempts : undefined;
}

function normalizeInjectionAttempts(value: unknown): DictationTrace["injectionAttempts"] {
  if (!Array.isArray(value)) return undefined;
  const attempts: NonNullable<DictationTrace["injectionAttempts"]> = [];
  for (const item of value) {
    if (!isObject(item) || typeof item.success !== "boolean") continue;
    const attempt: NonNullable<DictationTrace["injectionAttempts"]>[number] = {
      targetAppBundleId: typeof item.targetAppBundleId === "string" ? item.targetAppBundleId : null,
      targetAppName: typeof item.targetAppName === "string" ? item.targetAppName : null,
      success: item.success,
    };
    if (item.method === "ax" || item.method === "clipboard") attempt.method = item.method;
    if (typeof item.fallbackReason === "string") attempt.fallbackReason = item.fallbackReason;
    attempts.push(attempt);
  }
  return attempts.length > 0 ? attempts : undefined;
}

function normalizeOutcome(value: unknown): DictationTrace["outcome"] {
  switch (value) {
    case "injected":
    case "saved":
    case "rejected":
    case "failed":
    case "cancelled":
      return value;
    default:
      return "started";
  }
}

function copyTrace(trace: DictationTrace): DictationTrace {
  return JSON.parse(JSON.stringify(trace)) as DictationTrace;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return finiteNumber(value);
}

function isTranscriptAction(value: unknown): value is NonNullable<DictationTrace["qualityDecision"]>["action"] {
  return value === "insert" || value === "retry" || value === "save" || value === "reject";
}
