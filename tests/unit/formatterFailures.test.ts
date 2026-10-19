import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import { liveFormattingTimeoutMs } from "@main/dictation";
import { FORMATTER_KEY_REJECTED_REASON } from "@main/providers/formatting-constants";
import { OpenAILlmProvider } from "@main/providers/openai/openaiLlm";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

const FOUR_WORDS_OR_MORE = "this sentence has more than four words";

describe("live formatting deadline", () => {
  it("gives Groq 1.5 seconds and every other formatter 3.5 seconds", () => {
    expect(liveFormattingTimeoutMs("groq-llm")).toBe(1_500);
    expect(liveFormattingTimeoutMs(undefined)).toBe(1_500);
    expect(liveFormattingTimeoutMs("openrouter")).toBe(2_000);
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

  it("cleans later paragraphs after a rejected key without another request", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const { TranscriptionService } = await import("@main/transcription");
    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      formattingProvider: "openai-llm",
      providerApiKeys: [{ providerId: "openai-llm", key: "sk-test" }],
    }));

    const result = await service.formatTranscriptDetailed("First paragraph has enough words.\n\nWe we keep the repeated words here.");

    expect(result.text).toBe("First paragraph has enough words.\n\nWe keep the repeated words here.");
    expect(result.formatterStatusReason).toBe(FORMATTER_KEY_REJECTED_REASON);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the rejected-key reason when an earlier paragraph failed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const { TranscriptionService } = await import("@main/transcription");
    const service = new TranscriptionService(() => ({
      ...DEFAULT_SETTINGS,
      formattingProvider: "openai-llm",
      providerApiKeys: [{ providerId: "openai-llm", key: "sk-test" }],
    }));

    const result = await service.formatTranscriptDetailed(
      "First paragraph has enough words.\n\nSecond paragraph has enough words.\n\nThird paragraph should not request formatting.",
    );

    expect(result.formatterStatusReason).toBe(FORMATTER_KEY_REJECTED_REASON);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
