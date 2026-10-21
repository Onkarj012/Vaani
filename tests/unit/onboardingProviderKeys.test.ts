import { describe, expect, it } from "vitest";
import { decideProviderKeyDraft, onboardingNeedsLlmKey } from "@renderer/lib/providerKeyDraft";

describe("onboarding provider key drafts", () => {
  it.each([
    ["blank", ""],
    ["redacted renderer value", ""],
    ["whitespace-only", " \t\n "],
  ])("preserves a stored credential for a %s field", (_case, value) => {
    expect(decideProviderKeyDraft(value, "blur")).toBe("preserve");
  });

  it("saves a nonblank replacement credential", () => {
    expect(decideProviderKeyDraft("  replacement-key  ", "blur")).toBe("save");
  });
});

describe("onboarding cleanup key", () => {
  it.each([
    ["openrouter", "groq", true],
    ["openrouter", "openrouter", false],
    ["anthropic", "groq", true],
    ["groq-llm", "groq", false],
    [undefined, "groq", false],
  ] as const)("cleanup %s with transcription %s needs a key: %s", (llm, stt, expected) => {
    expect(onboardingNeedsLlmKey(llm, stt, true)).toBe(expected);
  });
});
