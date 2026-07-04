import Groq from "groq-sdk";
import { addedContentWords, missingContentWords } from "@shared/contentGuard";
import type { FormattingProvider } from "../types";
import { FORMATTING_PROMPT, MIN_WORDS_FOR_FORMATTING, STRICT_FORMATTING_PROMPT } from "../formatting-constants";
import { validateBearerEndpoint } from "../validation";

const FORMATTING_MODEL = "llama-3.1-8b-instant";

const FORMATTING_TIMEOUT_MS = 20_000;
const ADDED_CONTENT_WORD_SLACK = 3;

function hasSuspiciousContentChange(rawText: string, candidate: string): boolean {
  return (
    missingContentWords(rawText, candidate).length > 0
    || addedContentWords(rawText, candidate).length > ADDED_CONTENT_WORD_SLACK
  );
}

async function requestFormatting(apiKey: string, text: string, prompt: string, model: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FORMATTING_TIMEOUT_MS);
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
    }, { signal: controller.signal });
    return response.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export const GroqLlmProvider: FormattingProvider = {
  id: "groq-llm",
  name: "Groq Llama",
  requiresApiKey: true,
  models: [
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
  ],

  async format(rawText, options): Promise<string> {
    const text = rawText.trim();
    if (!text) return text;
    if (text.split(/\s+/).length < MIN_WORDS_FOR_FORMATTING) return text;
    if (!options.apiKey) return text;

    try {
      const model = options.model || FORMATTING_MODEL;
      const formatted = await requestFormatting(options.apiKey, text, FORMATTING_PROMPT, model);
      if (!formatted) return text;

      if (hasSuspiciousContentChange(text, formatted)) {
        const strictFormatted = await requestFormatting(options.apiKey, text, STRICT_FORMATTING_PROMPT, model);
        if (!strictFormatted || hasSuspiciousContentChange(text, strictFormatted)) return text;
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
    return validateBearerEndpoint("Groq", "https://api.groq.com/openai/v1/models", apiKey);
  },
};
