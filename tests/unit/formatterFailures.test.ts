import { afterEach, describe, expect, it, vi } from "vitest";
import { liveFormattingTimeoutMs } from "@main/dictation";
import { FORMATTER_KEY_REJECTED_REASON } from "@main/providers/formatting-constants";
import { OpenAILlmProvider } from "@main/providers/openai/openaiLlm";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

const FOUR_WORDS_OR_MORE = "this sentence has more than four words";

describe("live formatting deadline", () => {
  it("gives Groq 1.5 seconds and every other formatter 3.5 seconds", () => {
    expect(liveFormattingTimeoutMs("groq-llm")).toBe(1_500);
    expect(liveFormattingTimeoutMs(undefined)).toBe(1_500);
    expect(liveFormattingTimeoutMs("openrouter")).toBe(3_500);
    expect(liveFormattingTimeoutMs("anthropic")).toBe(3_500);
  });
});

describe("formatter failure reasons", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports a rejected key with the Settings reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));

    const result = await OpenAILlmProvider.format(FOUR_WORDS_OR_MORE, { apiKey: "sk-test", fillerWords: [] });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe(FORMATTER_KEY_REJECTED_REASON);
  });

  it("keeps the status message for other provider failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));

    const result = await OpenAILlmProvider.format(FOUR_WORDS_OR_MORE, { apiKey: "sk-test", fillerWords: [] });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("OpenAI API request failed with status 500.");
  });
});
