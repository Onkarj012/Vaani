import Groq from "groq-sdk";
import { addedContentWords, missingContentWords, stripReasoningBlocks } from "@shared/contentGuard";
import type { FormattingProvider, FormattingResult } from "../types";
import { formatterErrorReason, formatterResult } from "../types";
import {
  CHANGED_WORDS_REASON,
  EMPTY_REPLY_REASON,
  EMPTY_TRANSCRIPT_REASON,
  FORMATTED_REASON,
  FORMATTING_PROMPT,
  MIN_WORDS_FOR_FORMATTING,
  NO_API_KEY_REASON,
  STRICT_FORMATTING_PROMPT,
  TOO_SHORT_REASON,
} from "../formatting-constants";
import { validateBearerEndpoint } from "../validation";
import { createCancellationScope, isAbortError } from "@main/cancellation";
import { defaultModelFor, providerModels } from "@shared/modelList";

const FORMATTING_MODEL = defaultModelFor("cleanup", "groq-llm");

const FORMATTING_TIMEOUT_MS = 20_000;
const ADDED_CONTENT_WORD_SLACK = 3;

function hasSuspiciousContentChange(rawText: string, candidate: string): boolean {
  return (
    missingContentWords(rawText, candidate).length > 0
    || addedContentWords(rawText, candidate).length > ADDED_CONTENT_WORD_SLACK
  );
}

async function requestFormatting(apiKey: string, text: string, prompt: string, model: string, signal?: AbortSignal): Promise<string | null> {
  const scope = createCancellationScope(signal, Date.now() + FORMATTING_TIMEOUT_MS);
  try {
    const groq = new Groq({ apiKey });
    const response = await groq.chat.completions.create({
      model,
      temperature: 0,
      max_completion_tokens: Math.max(256, text.length * 2),
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `<transcript>\n${text}\n</transcript>` },
      ],
    }, { signal: scope.signal });
    if (scope.signal.aborted) throw new Error("Groq formatting request timed out.");
    return stripReasoningBlocks(response.choices[0]?.message?.content ?? "") || null;
  } catch (err) {
    if (signal?.aborted) throw err;
    if (scope.signal.aborted) throw new Error("Groq formatting request timed out.");
    if (isAbortError(err)) throw err;
    throw err;
  } finally {
    scope.dispose();
  }
}

export const GroqLlmProvider: FormattingProvider = {
  id: "groq-llm",
  name: "Groq Llama",
  requiresApiKey: true,
  models: providerModels("cleanup", "groq-llm"),

  async format(rawText, options): Promise<FormattingResult> {
    const text = rawText.trim();
    if (!text) return formatterResult("skipped", text, EMPTY_TRANSCRIPT_REASON);
    if (text.split(/\s+/).length < MIN_WORDS_FOR_FORMATTING) return formatterResult("skipped", text, TOO_SHORT_REASON);
    if (!options.apiKey) return formatterResult("skipped", text, NO_API_KEY_REASON);

    try {
      const model = options.model || FORMATTING_MODEL;
      const formatted = await requestFormatting(options.apiKey, text, options.systemPrompt || FORMATTING_PROMPT, model, options.signal);
      if (!formatted) return formatterResult("failed", text, EMPTY_REPLY_REASON);

      if (hasSuspiciousContentChange(text, formatted)) {
        const strictFormatted = await requestFormatting(options.apiKey, text, STRICT_FORMATTING_PROMPT, model, options.signal);
        if (!strictFormatted) return formatterResult("failed", text, EMPTY_REPLY_REASON);
        if (hasSuspiciousContentChange(text, strictFormatted)) return formatterResult("rejected", text, CHANGED_WORDS_REASON);
        return formatterResult("ran", strictFormatted, FORMATTED_REASON);
      }

      return formatterResult("ran", formatted, FORMATTED_REASON);
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) throw error;
      return formatterResult("failed", text, formatterErrorReason(error));
    }
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async validateApiKey(apiKey): Promise<{ valid: boolean; message: string }> {
    return validateBearerEndpoint("Groq", "https://api.groq.com/openai/v1/models", apiKey);
  },
};
