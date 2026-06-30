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
      rawAudio: isObject(item.rawAudio) ? item.rawAudio as unknown as DictationTrace["rawAudio"] : undefined,
      trimmedAudio: isObject(item.trimmedAudio) ? item.trimmedAudio as unknown as DictationTrace["trimmedAudio"] : undefined,
      rawAudioPath: typeof item.rawAudioPath === "string" ? item.rawAudioPath : null,
      sttProvider: typeof item.sttProvider === "string" ? item.sttProvider : null,
      sttLatencyMs: typeof item.sttLatencyMs === "number" ? item.sttLatencyMs : undefined,
      formattingLatencyMs: typeof item.formattingLatencyMs === "number" ? item.formattingLatencyMs : undefined,
      transcriptLength: typeof item.transcriptLength === "number" ? item.transcriptLength : undefined,
      quality: isObject(item.quality) ? item.quality as unknown as DictationTrace["quality"] : undefined,
      qualityDecision: isObject(item.qualityDecision) ? item.qualityDecision as unknown as DictationTrace["qualityDecision"] : undefined,
      providerAttempts: Array.isArray(item.providerAttempts) ? item.providerAttempts as DictationTrace["providerAttempts"] : undefined,
      injectionAttempts: Array.isArray(item.injectionAttempts) ? item.injectionAttempts as DictationTrace["injectionAttempts"] : undefined,
      injectionMethod: item.injectionMethod === "ax" || item.injectionMethod === "clipboard" ? item.injectionMethod : null,
      outcome: normalizeOutcome(item.outcome),
      rejectionReason: typeof item.rejectionReason === "string" ? item.rejectionReason as DictationTrace["rejectionReason"] : undefined,
      userMessage: typeof item.userMessage === "string" ? item.userMessage : undefined,
    }));
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
