import type { DictationStageSnapshot, DictationTrace } from "@shared/types";

export const DICTATION_TRACE_TEXT_LIMIT = 500;
export const DICTATION_TRACE_ARRAY_LIMIT = 20;

export function truncateTraceText(text: string): string {
  return text.length > DICTATION_TRACE_TEXT_LIMIT
    ? `${text.slice(0, DICTATION_TRACE_TEXT_LIMIT - 1)}…`
    : text;
}

export function buildTraceStageSnapshot(snapshot: DictationStageSnapshot): DictationStageSnapshot {
  const next: DictationStageSnapshot = { ...snapshot };
  if (next.rawTranscript !== undefined) next.rawTranscript = truncateTraceText(next.rawTranscript);
  if (next.cleanedText !== undefined) next.cleanedText = truncateTraceText(next.cleanedText);
  if (next.injectedText !== undefined) next.injectedText = truncateTraceText(next.injectedText);
  if (next.correctionsApplied) {
    next.correctionsApplied = next.correctionsApplied
      .slice(0, DICTATION_TRACE_ARRAY_LIMIT)
      .map(({ spoken, written }) => ({
        spoken: truncateTraceText(spoken),
        written: truncateTraceText(written),
      }));
  }
  if (next.contentGuardVerdict?.missingWords) {
    next.contentGuardVerdict = {
      ...next.contentGuardVerdict,
      missingWords: next.contentGuardVerdict.missingWords
        .slice(0, DICTATION_TRACE_ARRAY_LIMIT)
        .map(truncateTraceText),
    };
  }
  return next;
}

export function mergeDictationTracePatch(current: DictationTrace, patch: Partial<DictationTrace>): DictationTrace {
  const next: DictationTrace = { ...current, ...patch };
  if (patch.stages) {
    next.stages = buildTraceStageSnapshot({
      ...(current.stages ?? {}),
      ...patch.stages,
    });
  }
  return next;
}
