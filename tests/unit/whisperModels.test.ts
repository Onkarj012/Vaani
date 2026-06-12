import { describe, expect, it } from "vitest";
import { assertValidWhisperModelName, isValidWhisperModelName } from "@shared/whisperModels";

describe("Whisper model name validation", () => {
  it("accepts expected model names", () => {
    expect(isValidWhisperModelName("base.en")).toBe(true);
    expect(isValidWhisperModelName("small-q5_1")).toBe(true);
  });

  it("rejects path traversal and path separators", () => {
    expect(isValidWhisperModelName("../secret")).toBe(false);
    expect(isValidWhisperModelName("..")).toBe(false);
    expect(isValidWhisperModelName("small/en")).toBe(false);
    expect(isValidWhisperModelName("small\\en")).toBe(false);
  });

  it("throws a clear error for invalid names", () => {
    expect(() => assertValidWhisperModelName("../secret")).toThrow("Invalid Whisper model name");
  });
});
