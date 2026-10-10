import type { FormattingProvider, FormattingResult } from "../types";
import { formatterErrorReason, formatterResult } from "../types";
import {
  EMPTY_REPLY_REASON,
  EMPTY_TRANSCRIPT_REASON,
  FORMATTED_REASON,
  FORMATTING_PROMPT,
  MIN_WORDS_FOR_FORMATTING,
  NO_API_KEY_REASON,
  TOO_SHORT_REASON,
} from "../formatting-constants";
import { openRouterPostJson, validateOpenRouterKey } from "./client";
import { isAbortError } from "@main/cancellation";
import { defaultModelFor, providerModels } from "@shared/modelList";

interface ChatCompletionReply {
  choices: { message: { content: string | null } }[];
}

export const OpenRouterLlmProvider: FormattingProvider = {
  id: "openrouter",
  name: "OpenRouter",
  requiresApiKey: true,
  models: providerModels("cleanup", "openrouter"),

  // Formats one transcript through OpenRouter chat completions.
  async format(rawText, options): Promise<FormattingResult> {
    const text = rawText.trim();
    if (!text) return formatterResult("skipped", text, EMPTY_TRANSCRIPT_REASON);
    if (text.split(/\s+/).length < MIN_WORDS_FOR_FORMATTING) return formatterResult("skipped", text, TOO_SHORT_REASON);
    if (!options.apiKey) return formatterResult("skipped", text, NO_API_KEY_REASON);

    try {
      const reply = await openRouterPostJson<ChatCompletionReply>({
        path: "/chat/completions",
        apiKey: options.apiKey,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model || defaultModelFor("cleanup", "openrouter"),
          temperature: 0,
          max_tokens: Math.max(256, text.length * 2),
          messages: [
            { role: "system", content: options.systemPrompt || FORMATTING_PROMPT },
            { role: "user", content: `<transcript>\n${text}\n</transcript>` },
          ],
        }),
        signal: options.signal,
      });
      const formatted = reply.choices[0]?.message?.content?.trim();
      if (!formatted) return formatterResult("failed", text, EMPTY_REPLY_REASON);
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
    return validateOpenRouterKey(apiKey);
  },
};
