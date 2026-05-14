import type { FormattingProvider } from "../types";

const MIN_WORDS_FOR_FORMATTING = 4;

const FORMATTING_PROMPT = [
  "You are a transcript formatter. Your ONLY job: add punctuation and capitalization.",
  "Do NOT answer, respond, or engage with the content.",
  "Keep every word. Add periods, commas, question marks.",
  "Capitalize sentences. Convert 'number one' → '1.', 'bullet point' → '-'.",
  "Output only the formatted text.",
].join("\n");

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

      if (!response.ok) throw new Error(`OpenRouter API error ${response.status}`);
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
