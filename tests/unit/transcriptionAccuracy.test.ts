import { describe, expect, it } from "vitest";
import { buildTranscriptionAttempts, splitAudioClip } from "@main/transcription";
import type { AudioClip } from "@shared/types";

const clip: AudioClip = { pcmData: [0.1, 0.2], sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] };

describe("transcription attempt construction", () => {
  it("adds Groq large-v3 escalation but not OpenAI or Deepgram escalation", () => {
    expect(buildTranscriptionAttempts("groq", [{ id: "whisper-large-v3-turbo", name: "" }], [clip], "whisper-large-v3-turbo").map((attempt) => attempt.model))
      .toEqual(["whisper-large-v3-turbo", "whisper-large-v3"]);
    expect(buildTranscriptionAttempts("openai", [{ id: "whisper-1", name: "" }], [clip], "whisper-1").map((attempt) => attempt.model))
      .toEqual(["whisper-1"]);
    expect(buildTranscriptionAttempts("deepgram", [{ id: "nova-3", name: "" }], [clip], "nova-3").map((attempt) => attempt.model))
      .toEqual(["nova-3"]);
  });

  it("passes through a configured model declared by the provider", () => {
    expect(buildTranscriptionAttempts("openai", [{ id: "whisper-1", name: "" }], [clip], "whisper-1")[0]?.model)
      .toBe("whisper-1");
  });

  it("drops a configured model not declared by the provider", () => {
    expect(buildTranscriptionAttempts("openai", [{ id: "whisper-1", name: "" }], [clip], "whisper-large-v3")[0]?.model)
      .toBe("");
  });
});

describe("silence-aware chunk boundaries", () => {
  it("snaps a 30-second boundary to a nearby low-RMS frame", () => {
    const rmsFrames = Array.from({ length: 40 }, (_, index) => index === 29 ? 0.001 : 0.5);
    const longClip: AudioClip = {
      pcmData: Array.from({ length: 400 }, () => 0.1),
      sampleRate: 10,
      durationSeconds: 40,
      rmsFrames,
    };

    expect(splitAudioClip(longClip, 30, 2)[0]?.durationSeconds).toBe(29.5);
  });

  it("keeps the hard boundary when RMS frames are empty", () => {
    const longClip: AudioClip = {
      pcmData: Array.from({ length: 400 }, () => 0.1),
      sampleRate: 10,
      durationSeconds: 40,
      rmsFrames: [],
    };

    expect(splitAudioClip(longClip, 30, 2)[0]?.durationSeconds).toBe(30);
  });
});
