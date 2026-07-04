import type { FormattingProvider } from "../types";
import { addedContentWords, missingContentWords } from "@shared/contentGuard";
import { FORMATTING_PROMPT, MIN_WORDS_FOR_FORMATTING, STRICT_FORMATTING_PROMPT } from "../formatting-constants";
import { validateBearerEndpoint } from "../validation";

const LLM_TIMEOUT_MS = 20_000;
const ADDED_CONTENT_WORD_SLACK = 3;

function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = LLM_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
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
      model: options.model || "gpt-4o-mini",
      temperature: 0,
      max_completion_tokens: Math.max(256, text.length * 2),
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `<transcript>\n${text}\n</transcript>` },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI API is temporarily unavailable. Please try again.`);
  const data = await response.json() as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content?.trim() || null;
}

export const OpenAILlmProvider: FormattingProvider = {
  id: "openai-llm",
  name: "OpenAI GPT",
  requiresApiKey: true,
  models: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt-4o", name: "GPT-4o" },
  ],

  async format(rawText, options): Promise<string> {
    const text = rawText.trim();
    if (!text) return text;
    if (text.split(/\s+/).length < MIN_WORDS_FOR_FORMATTING) return text;
    if (!options.apiKey) return text;

    try {
      const formatted = await requestFormatting(text, options, options.systemPrompt || FORMATTING_PROMPT);
      if (!formatted) return text;
      if (ASSISTANT_REPLY_PATTERN.test(formatted)) return text;
      if (hasSuspiciousContentChange(text, formatted)) {
        const strictFormatted = await requestFormatting(text, options, STRICT_FORMATTING_PROMPT);
        if (
          !strictFormatted
          || ASSISTANT_REPLY_PATTERN.test(strictFormatted)
          || hasSuspiciousContentChange(text, strictFormatted)
        ) return text;
        return strictFormatted;
      }
      return formatted;
    } catch {
      return text;
    }
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async validateApiKey(apiKey): Promise<{ valid: boolean; message: string }> {
    return validateBearerEndpoint("OpenAI", "https://api.openai.com/v1/models", apiKey);
  },
};
