import { describe, expect, it } from "vitest";
import {
  buildTranscriptionPrompt,
  isLanguageSupportedByProvider,
  normalizeDeepgramLanguage,
  normalizeWhisperLanguage,
  resolveProfileLanguage,
  resolveLanguageForProvider,
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

  it("inherits the global language when an app profile is unset or auto", () => {
    expect(resolveProfileLanguage(undefined, "hi")).toBe("hi");
    expect(resolveProfileLanguage("auto", "mr")).toBe("mr");
    expect(resolveProfileLanguage("en", "hi")).toBe("en");
  });

  it("builds prompts with only user vocabulary — no instruction strings", () => {
    expect(buildTranscriptionPrompt("")).toBe("");
    expect(buildTranscriptionPrompt("Use Vaani spelling.")).toBe("Use Vaani spelling.");
    expect(buildTranscriptionPrompt("GitHub Claude RAG")).toBe("GitHub Claude RAG");
    const long = "x".repeat(700);
    expect(buildTranscriptionPrompt(long)).toHaveLength(600);
  });

  it("keeps Hinglish prompt-driven for Whisper without a single language code", () => {
    expect(resolveLanguageForProvider("hinglish", "groq")).toBeUndefined();
    expect(resolveLanguageForProvider("hinglish", "openai")).toBeUndefined();
  });

  it("maps Chinese to zh-CN for Deepgram", () => {
    expect(resolveLanguageForProvider("zh", "deepgram")).toBe("zh-CN");
  });

  it("restricts English-only local models to auto and English", () => {
    expect(isLanguageSupportedByProvider("auto", "local-whisper", "tiny.en")).toBe(true);
    expect(isLanguageSupportedByProvider("en", "local-whisper", "tiny.en")).toBe(true);
    expect(isLanguageSupportedByProvider("hi", "local-whisper", "tiny.en")).toBe(false);
    expect(isLanguageSupportedByProvider("hinglish", "local-whisper", "tiny.en")).toBe(false);
  });

  it("falls back deterministically for unsupported provider/language pairs", () => {
    // Deepgram does not support Punjabi -> auto-detect (null).
    expect(resolveLanguageForProvider("pa", "deepgram")).toBeNull();
    // English-only local model with a non-English code -> auto-detect (undefined).
    expect(resolveLanguageForProvider("hi", "local-whisper", "tiny.en")).toBeUndefined();
    expect(resolveLanguageForProvider("mr", "deepgram")).toBeNull();
    expect(resolveLanguageForProvider("pa", "deepgram")).toBeNull();
    expect(resolveLanguageForProvider("en", "deepgram")).toBe("en");
  });
});
