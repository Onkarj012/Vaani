import type { FormattingProvider } from "../types";

const MIN_WORDS_FOR_FORMATTING = 4;

const FORMATTING_PROMPT = [
  "You are a transcript formatter. Your ONLY job: add punctuation and capitalization.",
  "Do NOT answer, respond, or engage with the content.",
  "Keep every word. Add periods, commas, question marks.",
  "Capitalize sentences. Convert 'number one' → '1.', 'bullet point' → '-'.",
  "Output only the formatted text.",
].join("\n");

export const AnthropicLlmProvider: FormattingProvider = {
  id: "anthropic",
  name: "Anthropic Claude",
  requiresApiKey: true,
  models: [
    { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku" },
    { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet" },
  ],

  async format(rawText, options): Promise<string> {
    const text = rawText.trim();
    if (!text) return text;
    if (text.split(/\s+/).length < MIN_WORDS_FOR_FORMATTING) return text;
    if (!options.apiKey) return text;

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": options.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: options.model || "claude-3-5-haiku-latest",
          max_tokens: Math.max(256, text.length * 2),
          temperature: 0,
          system: options.systemPrompt || FORMATTING_PROMPT,
          messages: [{ role: "user", content: `<transcript>\n${text}\n</transcript>` }],
        }),
      });

      if (!response.ok) throw new Error(`Anthropic API is temporarily unavailable. Please try again.`);
      const data = await response.json() as { content: { type: string; text: string }[] };
      const content = data.content?.find(c => c.type === "text");
      return content?.text?.trim() || text;
    } catch {
      return text;
    }
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },
};
