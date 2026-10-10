import { describe, expect, it } from "vitest";
import {
  defaultModelFor,
  formatModelPrice,
  modelForProvider,
  pickerEntries,
  providerModels,
  resolveSessionModels,
} from "@shared/modelList";

const settings = {
  transcriptionProvider: "groq",
  transcriptionModel: "whisper-large-v3-turbo",
  formattingProvider: "groq-llm",
  formattingModel: "openai/gpt-oss-20b",
};

describe("model list helpers", () => {
  it("offers only visible entries in each picker", () => {
    const transcription = pickerEntries("transcription").map((entry) => entry.modelId);
    expect(transcription).toEqual([
      "openai/gpt-transcribe",
      "google/gemini-3.5-transcribe",
      "x-ai/grok-stt-1.0",
      "elevenlabs/scribe-v2",
      "mistralai/voxtral-mini-transcribe",
      "microsoft/mai-transcribe-2",
    ]);
    expect(pickerEntries("cleanup").map((entry) => entry.provider)).toContain("anthropic");
  });

  it("gives each provider its own list, with the Groq transcription fallback kept for adapters", () => {
    expect(providerModels("transcription", "groq")).toEqual([{ id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo" }]);
    expect(providerModels("cleanup", "openai-llm").map((model) => model.id)).toEqual(["gpt-6-luna"]);
    expect(providerModels("cleanup", "anthropic").map((model) => model.id)).toEqual(["claude-haiku-5-5"]);
  });

  it("uses the first listed model as each provider's default", () => {
    expect(defaultModelFor("transcription", "openrouter")).toBe("openai/gpt-transcribe");
    expect(defaultModelFor("cleanup", "openrouter")).toBe("anthropic/claude-haiku-5.5");
    expect(defaultModelFor("cleanup", "groq-llm")).toBe("openai/gpt-oss-20b");
    expect(defaultModelFor("transcription", "deepgram")).toBe("");
  });

  it("keeps a listed model and swaps an unlisted one for the provider default", () => {
    expect(modelForProvider("cleanup", "groq-llm", "openai/gpt-oss-120b")).toBe("openai/gpt-oss-120b");
    expect(modelForProvider("cleanup", "groq-llm", "llama-3.1-8b-instant")).toBe("openai/gpt-oss-20b");
    expect(modelForProvider("transcription", "deepgram", "nova-2")).toBe("nova-2");
  });

  it("pairs an app profile's provider override with a model from that provider", () => {
    const resolved = resolveSessionModels(settings, { id: "p", name: "Mail", appBundleIds: ["com.mail"], formattingProvider: "openai-llm" });
    expect(resolved).toEqual({
      transcriptionProvider: "groq",
      transcriptionModel: "whisper-large-v3-turbo",
      formattingProvider: "openai-llm",
      formattingModel: "gpt-6-luna",
    });
  });

  it("keeps the global models when a profile names the global providers", () => {
    const resolved = resolveSessionModels(settings, { id: "p", name: "Notes", appBundleIds: ["com.notes"], transcriptionProvider: "groq", formattingProvider: "groq-llm" });
    expect(resolved).toEqual(settings);
  });

  it("formats prices with their unit", () => {
    expect(formatModelPrice({ unit: "audio hour", amount: 0.27 })).toBe("$0.27 / audio hour");
    expect(formatModelPrice({ unit: "1M tokens", amount: 0.1, outputAmount: 0.5 })).toBe("$0.10 in · $0.50 out / 1M tokens");
    expect(formatModelPrice({ unit: "audio hour", amount: null })).toBe("price not confirmed");
  });
});
