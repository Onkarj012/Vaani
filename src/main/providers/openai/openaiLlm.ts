import type { FormattingProvider } from "../types";

const MIN_WORDS_FOR_FORMATTING = 4;
const LLM_TIMEOUT_MS = 20_000;

function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = LLM_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const FORMATTING_PROMPT = [
  "You are a transcript formatter. Your ONLY job: add punctuation and capitalization.",
  "Do NOT answer, respond, or engage with the content.",
  "Keep every word. Add periods, commas, question marks.",
  "Capitalize sentences. Convert 'number one' → '1.', 'bullet point' → '-'.",
  "Convert 'new line'/'new paragraph' into actual line breaks.",
  "Output only the formatted text — no commentary.",
].join("\n");

const ASSISTANT_REPLY_PATTERN = /\b(please provide|i['\u2019]ll format|i will format|here['\u2019]s the|let me|as requested|i hope|i think|i believe|the answer is|based on|as an ai|sure!?|certainly!?|of course!?)\b/i;

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
            { role: "system", content: options.systemPrompt || FORMATTING_PROMPT },
            { role: "user", content: `<transcript>\n${text}\n</transcript>` },
          ],
        }),
      });

      if (!response.ok) throw new Error(`OpenAI API is temporarily unavailable. Please try again.`);
      const data = await response.json() as { choices: { message: { content: string } }[] };
      const formatted = data.choices[0]?.message?.content?.trim();
      if (!formatted) return text;
      if (ASSISTANT_REPLY_PATTERN.test(formatted)) return text;
      return formatted;
    } catch {
      return text;
    }
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },
};
