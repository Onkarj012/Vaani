import { describe, expect, it } from "vitest";
import {
  buildTranscriptionPrompt,
  normalizeDeepgramLanguage,
  normalizeWhisperLanguage,
  resolveReportedLanguage
} from "../../src/main/providers/language";

describe("transcription language helpers", () => {
  it("does not force auto-detect or Hinglish through one Whisper language code", () => {
    expect(normalizeWhisperLanguage("auto")).toBeUndefined();
    expect(normalizeWhisperLanguage("hinglish")).toBeUndefined();
    expect(normalizeWhisperLanguage("hi")).toBe("hi");
  });

  it("uses Deepgram-compatible language codes only when a single language is selected", () => {
    expect(normalizeDeepgramLanguage("auto")).toBeNull();
    expect(normalizeDeepgramLanguage("hinglish")).toBeNull();
    expect(normalizeDeepgramLanguage("zh")).toBe("zh-CN");
  });

  it("does not report auto-detected language as English by default", () => {
    expect(resolveReportedLanguage("auto")).toBeNull();
    expect(resolveReportedLanguage("hi")).toBe("hi");
  });

  it("builds prompts that preserve multilingual speech instead of translating it", () => {
    expect(buildTranscriptionPrompt("auto", "")).toContain("Do not translate to English");
    expect(buildTranscriptionPrompt("hinglish", "Use Vaani spelling.")).toContain("Use Vaani spelling.");
  });
});
