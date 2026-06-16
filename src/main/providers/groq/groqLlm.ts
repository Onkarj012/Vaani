import Groq from "groq-sdk";
import type { FormattingProvider } from "../types";
import { validateBearerEndpoint } from "../validation";

const FORMATTING_MODEL = "llama-3.1-8b-instant";
const MIN_WORDS_FOR_FORMATTING = 4;
const ASSISTANT_REPLY_PATTERN = /\b(please provide|i['\u2019]ll format|i will format|raw transcript|according to the rules|i can help|here['\u2019]s the formatted|i need the|i need more|i need you to|however.*proceed|let me (format|help|know)|as requested|original text|to proceed|here is|i hope|i think|i believe|in my opinion|the answer is|to answer|based on|as an ai|as a language|the question|your question|you asked|you mentioned|would you like|feel free|let me know|can i help|how can i|i understand|i see you|here are some|sure!?|certainly!?|of course!?)\b/i;

const FORMATTING_PROMPT = [
  "You format raw speech transcripts. ONLY add punctuation and structure.",
  "Never answer, respond, or engage with the content.",
  "",
  "RULES:",
  "1. Keep every word — never remove, replace, reorder, or add words.",
  "2. Never summarize, paraphrase, or restructure.",
  "3. Add periods, commas, question marks based on speech rhythm.",
  "4. Capitalize first word of each sentence.",
  "",
  "NUMBERED LISTS — If the speaker uses number cues (one/two/three, first/second/third, number one/two, 1/2/3) before each item:",
  "- Format as a numbered list: '1.' '2.' '3.' — one item per line",
  "- Remove the spoken number cue word and replace with the digit marker",
  "  Example input: 'one change the provider two for example double click three and all that'",
  "  Example output:",
  "  1. Change the provider.",
  "  2. For example, double click.",
  "  3. And all that.",
  "",
  "BULLET LISTS — If the speaker lists 3+ items separated by commas or pauses (no number cues):",
  "- Put the intro sentence on its own line ending with a colon",
  "- Put each item on its own line with a dash prefix",
  "  Example input: 'I need to buy apples bananas and oranges'",
  "  Example output: 'I need to buy:",
  "  - Apples",
  "  - Bananas",
  "  - Oranges.'",
  "",
  "Output only the formatted text — no commentary, no tags."
].join("\n");

const STRICT_FORMATTING_PROMPT = [
  "You format raw speech transcripts. ONLY add punctuation and capitalization.",
  "Never answer, respond, or engage. Keep 100% of the words — delete nothing.",
  "Add periods, commas, question marks. Capitalize sentences.",
  "For lists of 3+ items, put each on its own line with a dash.",
  "Output only the formatted text."
].join("\n");

// Matches spoken list cues that the LLM converts to structured markers (1., 2., -).
// The bare number words (one–ten) are included so that "one do X, two do Y"
// doesn't cause false rejection when the LLM converts them to "1. Do X\n2. Do Y".
const SPOKEN_CUE_STRIP_RE = /\b(bullet\s*point|new\s+paragraph|new\s+line|next\s+line|number\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|no\.\s*\d+|point\s+\d+|item\s+\d+|first|second|third|fourth|fifth|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi;

function stripSpokenCues(text: string): string {
  return text.replace(SPOKEN_CUE_STRIP_RE, "").replace(/\s{2,}/g, " ").trim();
}

function looksSuspicious(rawText: string, formattedText: string): boolean {
  if (!formattedText.trim()) return true;
  if (ASSISTANT_REPLY_PATTERN.test(formattedText)) return true;

  const rawStripped = stripSpokenCues(rawText);

  if (formattedText.length < rawStripped.length * 0.55) return true;
  if (formattedText.length > rawText.length * 1.5 + 50) return true;

  const firstSentenceOverlap = calculateFirstSentenceOverlap(rawText, formattedText);
  if (firstSentenceOverlap < 0.5) return true;

  if (!hasLeadWordOverlap(rawText, formattedText)) return true;
  if (!hasOrderedTokenPreservation(rawText, formattedText)) return true;

  const rawWords = rawText.trim().split(/\s+/);
  const formattedWords = formattedText.trim().split(/\s+/);
  const cueWords = (rawText.match(SPOKEN_CUE_STRIP_RE) ?? []).join(" ").trim().split(/\s+/).filter(Boolean).length;
  const allowedWordDiff = 3 + cueWords;

  if (Math.abs(formattedWords.length - rawWords.length) > allowedWordDiff) return true;

  const rawVocabulary = tokenizeForComparison(rawStripped);
  const formattedVocabulary = tokenizeForComparison(formattedText);
  if (rawVocabulary.length > 0) {
    const overlapCount = rawVocabulary.filter((word) => formattedVocabulary.includes(word)).length;
    if (overlapCount / rawVocabulary.length < 0.55) return true;
  }

  return false;
}

function tokenizeForComparison(text: string): string[] {
  return Array.from(new Set(text.toLowerCase().split(/\s+/).map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")).filter(Boolean)));
}

function tokenizeOrdered(text: string): string[] {
  return text.toLowerCase().split(/\s+/).map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")).filter(Boolean);
}

function firstSentence(text: string): string {
  const stripped = stripSpokenCues(text).trim();
  const match = stripped.match(/^(.+?)(?:[.!?](?:\s|$)|\n|$)/);
  return (match?.[1] ?? stripped).trim();
}

function calculateFirstSentenceOverlap(rawText: string, formattedText: string): number {
  const rawTokens = tokenizeOrdered(firstSentence(rawText));
  const formattedTokens = tokenizeOrdered(firstSentence(formattedText));
  if (rawTokens.length === 0) return 1;
  const formattedVocabulary = new Set(formattedTokens);
  const overlap = rawTokens.filter((token) => formattedVocabulary.has(token)).length;
  return overlap / rawTokens.length;
}

function hasLeadWordOverlap(rawText: string, formattedText: string): boolean {
  const rawLead = tokenizeOrdered(stripSpokenCues(rawText)).slice(0, 5);
  const formattedLead = tokenizeOrdered(formattedText).slice(0, 5);
  const sampleSize = Math.min(rawLead.length, formattedLead.length, 5);
  if (sampleSize < 3) return true;
  const formattedSample = new Set(formattedLead.slice(0, sampleSize));
  const overlap = rawLead.slice(0, sampleSize).filter((token) => formattedSample.has(token)).length;
  return overlap / sampleSize >= 0.5;
}

function hasOrderedTokenPreservation(rawText: string, formattedText: string): boolean {
  const ignorable = new Set(["a", "an", "and", "or", "the"]);
  const rawTokens = tokenizeOrdered(stripSpokenCues(rawText)).filter((token) => !ignorable.has(token));
  const formattedTokens = tokenizeOrdered(formattedText).filter((token) => !/^\d+$/.test(token) && !ignorable.has(token));
  if (rawTokens.length < 4) return true;

  let formattedIndex = 0;
  let matched = 0;
  for (const rawToken of rawTokens) {
    while (formattedIndex < formattedTokens.length && formattedTokens[formattedIndex] !== rawToken) {
      formattedIndex += 1;
    }
    if (formattedIndex < formattedTokens.length) { matched += 1; formattedIndex += 1; }
  }
  return matched / rawTokens.length >= 0.78;
}

const FORMATTING_TIMEOUT_MS = 20_000;

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

      if (looksSuspicious(text, formatted)) {
        const strictFormatted = await requestFormatting(options.apiKey, text, STRICT_FORMATTING_PROMPT, model);
        if (!strictFormatted || looksSuspicious(text, strictFormatted)) return text;
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
