import type { FormattingProvider, FormattingResult } from "../types";
import { formatterErrorReason, formatterResult } from "../types";
import { judgeFormatterReply, stripReasoningBlocks } from "@shared/contentGuard";
import { defaultModelFor, providerModels } from "@shared/modelList";
import {
  CHAT_REPLY_REASON,
  EMPTY_REPLY_REASON,
  EMPTY_TRANSCRIPT_REASON,
  FORMATTED_REASON,
  FORMATTING_PROMPT,
  LLM_TIMEOUT_MS,
  MIN_WORDS_FOR_FORMATTING,
  NO_API_KEY_REASON,
  STRICT_FORMATTING_PROMPT,
  TOO_SHORT_REASON,
} from "../formatting-constants";
import { validateBearerEndpoint } from "../validation";
import { isAbortError, runWithDeadline } from "@main/cancellation";


const ASSISTANT_REPLY_PATTERN = /\b(please provide|i['\u2019]ll format|i will format|here['\u2019]s the|let me|as requested|i hope|i think|i believe|the answer is|based on|as an ai|sure!?|certainly!?|of course!?)\b/i;

// Why the formatter reply must be rejected, or null when its words check out. Matches the service's final guard.
function contentRejection(rawText: string, candidate: string, fillers: readonly string[], literal: boolean | undefined): string | null {
  return judgeFormatterReply(rawText, candidate, fillers, { speechNoise: !literal }).rejection;
}

async function requestFormatting(text: string, options: Parameters<FormattingProvider["format"]>[1], prompt: string): Promise<string | null> {
  const data = await runWithDeadline(options.signal, LLM_TIMEOUT_MS, async (signal) => {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
      signal,
    });
    if (!response.ok) throw Object.assign(new Error(`OpenAI API request failed with status ${response.status}.`), { status: response.status });
    return await response.json() as { choices: { message: { content: string } }[] };
  });
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
      if (contentRejection(text, formatted, options.fillerWords, options.literal)) {
        const strictFormatted = await requestFormatting(text, options, options.strictSystemPrompt || STRICT_FORMATTING_PROMPT);
        if (!strictFormatted) return formatterResult("failed", text, EMPTY_REPLY_REASON);
        if (ASSISTANT_REPLY_PATTERN.test(strictFormatted)) return formatterResult("rejected", text, CHAT_REPLY_REASON);
        const strictRejection = contentRejection(text, strictFormatted, options.fillerWords, options.literal);
        if (strictRejection) return formatterResult("rejected", text, strictRejection);
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
