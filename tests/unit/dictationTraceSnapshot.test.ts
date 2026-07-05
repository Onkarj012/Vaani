import { describe, expect, it } from "vitest";
import type { DictationTrace } from "@shared/types";
import {
  DICTATION_TRACE_ARRAY_LIMIT,
  DICTATION_TRACE_TEXT_LIMIT,
  buildTraceStageSnapshot,
  mergeDictationTracePatch,
  truncateTraceText,
} from "@main/dictationTraceSnapshot";

function baseTrace(): DictationTrace {
  return {
    id: "trace-1",
    sessionId: "session-1",
    startedAt: "2026-07-02T00:00:00.000Z",
    targetAppBundleId: "com.apple.TextEdit",
    targetAppName: "TextEdit",
    outcome: "started",
  };
}

describe("dictation trace snapshots", () => {
  it("builds the per-stage trace record shape", () => {
    const merged = mergeDictationTracePatch(baseTrace(), {
      stages: {
        rawTranscript: "open get hub",
        qualityDecision: {
          action: "insert",
          reason: "usable",
          confidence: 0.92,
          noSpeechProbability: 0.01,
          attemptCount: 2,
        },
        cleanedText: "Open GitHub.",
        formatterUsed: "llm",
        contentGuardVerdict: { passed: true },
        correctionsApplied: [{ spoken: "get hub", written: "GitHub" }],
        injectedText: "Open GitHub.",
        injectionStrategy: "clipboard",
        outcome: "injected",
      },
      outcome: "injected",
    });

    expect(merged.stages).toEqual({
      rawTranscript: "open get hub",
      qualityDecision: {
        action: "insert",
        reason: "usable",
        confidence: 0.92,
        noSpeechProbability: 0.01,
        attemptCount: 2,
      },
      cleanedText: "Open GitHub.",
      formatterUsed: "llm",
      contentGuardVerdict: { passed: true },
      correctionsApplied: [{ spoken: "get hub", written: "GitHub" }],
      injectedText: "Open GitHub.",
      injectionStrategy: "clipboard",
      outcome: "injected",
    });
    expect(merged.outcome).toBe("injected");
  });

  it("truncates stored trace text fields at 500 chars with an ellipsis", () => {
    const longText = "x".repeat(DICTATION_TRACE_TEXT_LIMIT + 1);

    expect(truncateTraceText(longText)).toHaveLength(DICTATION_TRACE_TEXT_LIMIT);
    expect(truncateTraceText(longText)).toBe(`${"x".repeat(DICTATION_TRACE_TEXT_LIMIT - 1)}…`);

    expect(buildTraceStageSnapshot({
      rawTranscript: longText,
      cleanedText: longText,
      injectedText: longText,
      correctionsApplied: [{ spoken: longText, written: longText }],
      contentGuardVerdict: { passed: false, missingWords: [longText] },
    })).toMatchObject({
      rawTranscript: `${"x".repeat(DICTATION_TRACE_TEXT_LIMIT - 1)}…`,
      cleanedText: `${"x".repeat(DICTATION_TRACE_TEXT_LIMIT - 1)}…`,
      injectedText: `${"x".repeat(DICTATION_TRACE_TEXT_LIMIT - 1)}…`,
      correctionsApplied: [{
        spoken: `${"x".repeat(DICTATION_TRACE_TEXT_LIMIT - 1)}…`,
        written: `${"x".repeat(DICTATION_TRACE_TEXT_LIMIT - 1)}…`,
      }],
      contentGuardVerdict: { missingWords: [`${"x".repeat(DICTATION_TRACE_TEXT_LIMIT - 1)}…`] },
    });
  });

  it("caps trace arrays while preserving per-string truncation", () => {
    const longText = "x".repeat(DICTATION_TRACE_TEXT_LIMIT + 1);
    const snapshot = buildTraceStageSnapshot({
      correctionsApplied: Array.from({ length: DICTATION_TRACE_ARRAY_LIMIT + 5 }, (_, index) => ({
        spoken: `${index}:${longText}`,
        written: `${index}:${longText}`,
      })),
      contentGuardVerdict: {
        passed: false,
        missingWords: Array.from({ length: DICTATION_TRACE_ARRAY_LIMIT + 5 }, (_, index) => `${index}:${longText}`),
      },
    });

    expect(snapshot.correctionsApplied).toHaveLength(DICTATION_TRACE_ARRAY_LIMIT);
    expect(snapshot.correctionsApplied?.at(0)?.spoken).toHaveLength(DICTATION_TRACE_TEXT_LIMIT);
    expect(snapshot.correctionsApplied?.at(-1)?.spoken.startsWith(`${DICTATION_TRACE_ARRAY_LIMIT - 1}:`)).toBe(true);
    expect(snapshot.contentGuardVerdict?.missingWords).toHaveLength(DICTATION_TRACE_ARRAY_LIMIT);
    expect(snapshot.contentGuardVerdict?.missingWords?.at(0)).toHaveLength(DICTATION_TRACE_TEXT_LIMIT);
    expect(snapshot.contentGuardVerdict?.missingWords?.at(-1)?.startsWith(`${DICTATION_TRACE_ARRAY_LIMIT - 1}:`)).toBe(true);
  });
});
