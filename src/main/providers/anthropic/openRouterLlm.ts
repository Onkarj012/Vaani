import type { FormattingProvider } from "../types";
import { MIN_WORDS_FOR_FORMATTING, FORMATTING_PROMPT } from "../formatting-constants";

export const OpenRouterLlmProvider: FormattingProvider = {
  id: "openrouter",
  name: "OpenRouter",
  requiresApiKey: true,
  models: [
    { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku" },
    { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash" },
  ],

  async format(rawText, options): Promise<string> {
    const text = rawText.trim();
    if (!text) return text;
    if (text.split(/\s+/).length < MIN_WORDS_FOR_FORMATTING) return text;
    if (!options.apiKey) return text;

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
          "HTTP-Referer": "https://vaani.app",
          "X-Title": "Vaani",
        },
        body: JSON.stringify({
          model: options.model || "openai/gpt-4o-mini",
          temperature: 0,
          max_tokens: Math.max(256, text.length * 2),
          messages: [
            { role: "system", content: options.systemPrompt || FORMATTING_PROMPT },
            { role: "user", content: `<transcript>\n${text}\n</transcript>` },
          ],
        }),
      });

      if (!response.ok) throw new Error(`OpenRouter API is temporarily unavailable. Please try again.`);
      const data = await response.json() as { choices: { message: { content: string } }[] };
      return data.choices[0]?.message?.content?.trim() || text;
    } catch {
      return text;
    }
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },
};
