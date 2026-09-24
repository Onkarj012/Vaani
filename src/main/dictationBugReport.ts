import type {
  AudioQualityMetrics,
  DictationBugReport,
  DictationEntry,
  DictationTrace,
  InsertionVerificationTrace,
  TranscriptQualityDecision,
  TranscriptionQualityMetadata,
} from "@shared/types";

type BugReportEntry = NonNullable<DictationBugReport["entry"]>;
type BugReportTrace = NonNullable<DictationBugReport["trace"]>;
type BugReportQuality = NonNullable<BugReportTrace["quality"]>;
type BugReportProviderAttempt = NonNullable<BugReportTrace["providerAttempts"]>[number];
type BugReportInjectionAttempt = NonNullable<BugReportTrace["injectionAttempts"]>[number];
type BugReportStages = NonNullable<BugReportTrace["stages"]>;

export function createDictationBugReport(
  entry: DictationEntry | null,
  trace: DictationTrace | null,
  generatedAt: string,
  appVersion?: string,
): DictationBugReport {
  return {
    entry: copyEntryMetadata(entry),
    trace: copyTraceMetadata(trace),
    generatedAt,
    appVersion,
  };
}

function copyEntryMetadata(entry: DictationEntry | null): BugReportEntry | null {
  if (!entry) return null;
  return {
    id: entry.id,
    traceId: entry.traceId,
    timestamp: entry.timestamp,
    durationSeconds: entry.durationSeconds,
    injectionStatus: entry.injectionStatus,
    injectionMethod: entry.injectionMethod,
    language: entry.language,
    detectedLanguage: entry.detectedLanguage,
  };
}

function copyTraceMetadata(trace: DictationTrace | null): BugReportTrace | null {
  if (!trace) return null;
  return {
    id: trace.id,
    sessionId: trace.sessionId,
    startedAt: trace.startedAt,
    buildIdentifier: trace.buildIdentifier,
    completedAt: trace.completedAt,
    hotkeyReleasedAt: trace.hotkeyReleasedAt,
    rawAudio: copyAudioQuality(trace.rawAudio),
    trimmedAudio: copyAudioQuality(trace.trimmedAudio),
    sttProvider: trace.sttProvider,
    sttLatencyMs: trace.sttLatencyMs,
    formattingLatencyMs: trace.formattingLatencyMs,
    transcriptLength: trace.transcriptLength,
    quality: copyTranscriptionQuality(trace.quality),
    qualityDecision: copyQualityDecision(trace.qualityDecision),
    providerAttempts: trace.providerAttempts?.map(copyProviderAttempt),
    injectionAttempts: trace.injectionAttempts?.map(copyInjectionAttempt),
    injectionMethod: trace.injectionMethod,
    stages: copyStages(trace.stages),
    outcome: trace.outcome,
    rejectionReason: trace.rejectionReason,
  };
}

function copyAudioQuality(metrics: AudioQualityMetrics | undefined): AudioQualityMetrics | undefined {
  if (!metrics) return undefined;
  return {
    durationSeconds: metrics.durationSeconds,
    sampleRate: metrics.sampleRate,
    sampleCount: metrics.sampleCount,
    rmsAverage: metrics.rmsAverage,
    rmsPeak: metrics.rmsPeak,
    peakAmplitude: metrics.peakAmplitude,
    clippingRatio: metrics.clippingRatio,
    silenceRatio: metrics.silenceRatio,
  };
}

function copyTranscriptionQuality(quality: TranscriptionQualityMetadata | undefined): BugReportQuality | undefined {
  if (!quality) return undefined;
  return {
    provider: quality.provider,
    attemptCount: quality.attemptCount,
    supportsConfidence: quality.supportsConfidence,
    confidence: quality.confidence,
    noSpeechProbability: quality.noSpeechProbability,
    avgLogprob: quality.avgLogprob,
    compressionRatio: quality.compressionRatio,
    segmentCount: quality.segmentCount,
    transcriptLength: quality.transcriptLength,
    chunkCount: quality.chunkCount,
    chunkDurationsSeconds: quality.chunkDurationsSeconds ? [...quality.chunkDurationsSeconds] : undefined,
    chunkOverlapSeconds: quality.chunkOverlapSeconds,
    decision: copyQualityDecision(quality.decision),
  };
}

function copyQualityDecision(decision: TranscriptQualityDecision | undefined): Pick<TranscriptQualityDecision, "action"> | undefined {
  return decision ? { action: decision.action } : undefined;
}

function copyProviderAttempt(attempt: NonNullable<DictationTrace["providerAttempts"]>[number]): BugReportProviderAttempt {
  return {
    provider: attempt.provider,
    success: attempt.success,
    attempt: attempt.attempt,
    latencyMs: attempt.latencyMs,
    outcome: attempt.outcome,
    errorClass: attempt.errorClass,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    deadlineAt: attempt.deadlineAt,
    quality: copyTranscriptionQuality(attempt.quality),
  };
}

function copyInjectionAttempt(attempt: NonNullable<DictationTrace["injectionAttempts"]>[number]): BugReportInjectionAttempt {
  return {
    method: attempt.method,
    success: attempt.success,
    verification: copyInsertionVerification(attempt.verification),
  };
}

function copyInsertionVerification(verification: InsertionVerificationTrace | undefined): InsertionVerificationTrace | undefined {
  if (!verification) return undefined;
  return {
    readable: verification.readable,
    passed: verification.passed,
    repaired: verification.repaired,
    reason: verification.reason,
  };
}

function copyStages(stages: DictationTrace["stages"]): BugReportStages | undefined {
  if (!stages) return undefined;
  return {
    qualityDecision: stages.qualityDecision ? {
      action: stages.qualityDecision.action,
      confidence: stages.qualityDecision.confidence,
      noSpeechProbability: stages.qualityDecision.noSpeechProbability,
      attemptCount: stages.qualityDecision.attemptCount,
    } : undefined,
    formatterUsed: stages.formatterUsed,
    contentGuardVerdict: stages.contentGuardVerdict ? { passed: stages.contentGuardVerdict.passed } : undefined,
    injectionStrategy: stages.injectionStrategy,
    insertionVerification: copyInsertionVerification(stages.insertionVerification),
    outcome: stages.outcome,
  };
}
