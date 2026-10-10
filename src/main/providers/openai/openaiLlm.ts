import type { FormattingProvider, FormattingResult } from "../types";
import { formatterErrorReason, formatterResult } from "../types";
import { addedContentWords, missingContentWords, stripReasoningBlocks } from "@shared/contentGuard";
import { defaultModelFor, providerModels } from "@shared/modelList";
import {
  CHANGED_WORDS_REASON,
  CHAT_REPLY_REASON,
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
import { isAbortError } from "@main/cancellation";
import { createCancellationScope } from "@main/cancellation";

const LLM_TIMEOUT_MS = 20_000;
const ADDED_CONTENT_WORD_SLACK = 3;

function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = LLM_TIMEOUT_MS): Promise<Response> {
  const scope = createCancellationScope(init.signal ?? undefined, Date.now() + timeoutMs);
  return (async () => {
    try {
      const response = await fetch(input, { ...init, signal: scope.signal });
      if (scope.signal.aborted && !init.signal?.aborted) throw new Error("Request timed out.");
      return response;
    } catch (error) {
      if (scope.signal.aborted && !init.signal?.aborted) throw new Error("Request timed out.");
      throw error;
    } finally {
      scope.dispose();
    }
  })();
}

const ASSISTANT_REPLY_PATTERN = /\b(please provide|i['\u2019]ll format|i will format|here['\u2019]s the|let me|as requested|i hope|i think|i believe|the answer is|based on|as an ai|sure!?|certainly!?|of course!?)\b/i;

function hasSuspiciousContentChange(rawText: string, candidate: string): boolean {
  return (
    missingContentWords(rawText, candidate).length > 0
    || addedContentWords(rawText, candidate).length > ADDED_CONTENT_WORD_SLACK
  );
}

async function requestFormatting(text: string, options: Parameters<FormattingProvider["format"]>[1], prompt: string): Promise<string | null> {
  const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || defaultModelFor("cleanup", "openai-llm"),
      temperature: 0,
      max_completion_tokens: Math.max(256, text.length * 2),
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `<transcript>\n${text}\n</transcript>` },
      ],
    }),
    signal: options.signal,
  });

  if (!response.ok) throw new Error(`OpenAI API request failed with status ${response.status}.`);
  const data = await response.json() as { choices: { message: { content: string } }[] };
  return stripReasoningBlocks(data.choices[0]?.message?.content ?? "") || null;
}

export const OpenAILlmProvider: FormattingProvider = {
  id: "openai-llm",
  name: "OpenAI GPT",
  requiresApiKey: true,
  models: providerModels("cleanup", "openai-llm"),

  async format(rawText, options): Promise<FormattingResult> {
    const text = rawText.trim();
    if (!text) return formatterResult("skipped", text, EMPTY_TRANSCRIPT_REASON);
    if (text.split(/\s+/).length < MIN_WORDS_FOR_FORMATTING) return formatterResult("skipped", text, TOO_SHORT_REASON);
    if (!options.apiKey) return formatterResult("skipped", text, NO_API_KEY_REASON);

    try {
      const formatted = await requestFormatting(text, options, options.systemPrompt || FORMATTING_PROMPT);
      if (!formatted) return formatterResult("failed", text, EMPTY_REPLY_REASON);
      if (ASSISTANT_REPLY_PATTERN.test(formatted)) return formatterResult("rejected", text, CHAT_REPLY_REASON);
      if (hasSuspiciousContentChange(text, formatted)) {
        const strictFormatted = await requestFormatting(text, options, STRICT_FORMATTING_PROMPT);
        if (!strictFormatted) return formatterResult("failed", text, EMPTY_REPLY_REASON);
        if (ASSISTANT_REPLY_PATTERN.test(strictFormatted)) return formatterResult("rejected", text, CHAT_REPLY_REASON);
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
    return validateBearerEndpoint("OpenAI", "https://api.openai.com/v1/models", apiKey);
  },
};
