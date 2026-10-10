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
import { validateBearerEndpoint } from "../validation";
import { isAbortError } from "@main/cancellation";

export const AnthropicLlmProvider: FormattingProvider = {
  id: "anthropic",
  name: "Anthropic Claude",
  requiresApiKey: true,
  models: [
    { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku" },
    { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet" },
  ],

  async format(rawText, options): Promise<FormattingResult> {
    const text = rawText.trim();
    if (!text) return formatterResult("skipped", text, EMPTY_TRANSCRIPT_REASON);
    if (text.split(/\s+/).length < MIN_WORDS_FOR_FORMATTING) return formatterResult("skipped", text, TOO_SHORT_REASON);
    if (!options.apiKey) return formatterResult("skipped", text, NO_API_KEY_REASON);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": options.apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: options.signal,
        body: JSON.stringify({
          model: options.model || "claude-3-5-haiku-latest",
          max_tokens: Math.max(256, text.length * 2),
          temperature: 0,
          system: options.systemPrompt || FORMATTING_PROMPT,
          messages: [{ role: "user", content: `<transcript>\n${text}\n</transcript>` }],
        }),
      });

      if (!response.ok) throw new Error(`Anthropic API request failed with status ${response.status}.`);
      const data = await response.json() as { content: { type: string; text: string }[] };
      const formatted = data.content?.find(c => c.type === "text")?.text?.trim();
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
    return validateBearerEndpoint("Anthropic", "https://api.anthropic.com/v1/models", apiKey, "x-api-key", {
      "anthropic-version": "2023-06-01",
    });
  },
};
