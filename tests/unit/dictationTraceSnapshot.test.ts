import { describe, expect, it } from "vitest";
import type { DictationTrace } from "@shared/types";
import { DICTATION_TRACE_TEXT_LIMIT, buildTraceStageSnapshot, mergeDictationTracePatch, truncateTraceText } from "@main/dictationTraceSnapshot";

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

    expect(truncateTraceText(longText)).toHaveLength(DICTATION_TRACE_TEXT_LIMIT + 1);
    expect(truncateTraceText(longText)).toBe(`${"x".repeat(DICTATION_TRACE_TEXT_LIMIT)}…`);

    expect(buildTraceStageSnapshot({
      rawTranscript: longText,
      cleanedText: longText,
      injectedText: longText,
      correctionsApplied: [{ spoken: longText, written: longText }],
      contentGuardVerdict: { passed: false, missingWords: [longText] },
    })).toMatchObject({
      rawTranscript: `${"x".repeat(DICTATION_TRACE_TEXT_LIMIT)}…`,
      cleanedText: `${"x".repeat(DICTATION_TRACE_TEXT_LIMIT)}…`,
      injectedText: `${"x".repeat(DICTATION_TRACE_TEXT_LIMIT)}…`,
      correctionsApplied: [{
        spoken: `${"x".repeat(DICTATION_TRACE_TEXT_LIMIT)}…`,
        written: `${"x".repeat(DICTATION_TRACE_TEXT_LIMIT)}…`,
      }],
      contentGuardVerdict: { missingWords: [`${"x".repeat(DICTATION_TRACE_TEXT_LIMIT)}…`] },
    });
  });
});
