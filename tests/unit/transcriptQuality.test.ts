import { describe, expect, it } from "vitest";
import { decideTranscriptInsertion, finalizeTranscriptDecision } from "@main/transcriptQuality";
import type { TranscriptionQualityMetadata } from "@shared/types";

const quietClip = { rmsFrames: [0.0001, 0.0002, 0.0001] };
const speechClip = { rmsFrames: [0.03, 0.05, 0.04] };

function quality(patch: Partial<TranscriptionQualityMetadata>): TranscriptionQualityMetadata {
  return {
    provider: "test",
    attemptCount: 1,
    supportsConfidence: true,
    transcriptLength: 8,
    ...patch,
  };
}

describe("decideTranscriptInsertion", () => {
  it("retries common silence hallucinations on quiet audio", () => {
    expect(decideTranscriptInsertion("thank you", quietClip)).toEqual({
      action: "retry",
      reason: "common-silence-hallucination",
    });
    expect(decideTranscriptInsertion("sorry", quietClip).action).toBe("retry");
  });

  it("allows a high-energy valid politeness phrase", () => {
    expect(decideTranscriptInsertion("thank you", speechClip)).toEqual({
      action: "insert",
      reason: "passed",
    });
  });

  it("rejects empty clips and single-letter fragments", () => {
    expect(decideTranscriptInsertion("", speechClip).action).toBe("reject");
    expect(decideTranscriptInsertion("l", speechClip)).toEqual({
      action: "reject",
      reason: "single-letter-fragment",
    });
  });

  it("retries provider low-confidence output", () => {
    expect(decideTranscriptInsertion("hello", speechClip, quality({ confidence: 0.2 }))).toEqual({
      action: "retry",
      reason: "provider-low-confidence",
    });
    expect(decideTranscriptInsertion("hello", speechClip, quality({ noSpeechProbability: 0.8 })).action).toBe("retry");
  });

  it("converts exhausted retries into a save decision", () => {
    expect(finalizeTranscriptDecision({ action: "retry", reason: "quiet-short-fragment" })).toEqual({
      action: "save",
      reason: "quiet-short-fragment",
    });
  });
});
