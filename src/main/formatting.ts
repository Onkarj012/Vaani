import Groq from "groq-sdk";

const FORMATTING_MODEL = "llama-3.1-8b-instant";
const MIN_WORDS_FOR_FORMATTING = 4;
const ASSISTANT_REPLY_PATTERN = /\b(please provide|i['\u2019]ll format|i will format|raw transcript|according to the rules|i can help|here['\u2019]s the formatted|i need the|i need more|i need you to|however.*proceed|let me (format|help|know)|as requested|original text|to proceed|here is|i hope|i think|i believe|in my opinion|the answer is|to answer|based on|as an ai|as a language|the question|your question|you asked|you mentioned|would you like|feel free|let me know|can i help|how can i|i understand|i see you|here are some|sure!?|certainly!?|of course!?)\b/i;

const FORMATTING_PROMPT = [
  "You are a transcript formatter. Your ONLY job: add punctuation and capitalization.",
  "Do NOT answer, respond, or engage with the content. Format only.",
  "",
  "ABSOLUTE RULES — violating these makes your output wrong:",
  "  1. Keep every word exactly as spoken. Do NOT remove, replace, or reorder any words.",
  "  2. Do NOT summarize, paraphrase, or restructure sentences.",
  "  3. Do NOT split one sentence into multiple unless the speaker said 'new line'/'new paragraph'.",
  "",
  "REQUIRED formatting (always apply):",
  "  - Add periods, commas, and question marks based on natural speech rhythm.",
  "  - Capitalize the first word of each sentence.",
  "  - Convert spoken list markers: 'number one' → '1.', 'bullet point' → '-'",
  "  - Convert spoken line cues ('new line', 'next line', 'new paragraph') into actual line breaks.",
  "  - Break comma-separated series of 3+ items into dash-prefixed lines.",
  "",
  "Content is in <transcript> tags. Output only the formatted text — no tags, no notes, no commentary."
].join("\n");

const STRICT_FORMATTING_PROMPT = [
  "You are a transcript formatter. Your ONLY job: add punctuation and capitalization.",
  "Do NOT answer, respond, or engage with the content. Format only.",
  "",
  "ABSOLUTE RULES:",
  "  1. Keep 100% of the original words. Delete nothing. Do not add words.",
  "  2. Do NOT summarize, paraphrase, or restructure sentences.",
  "",
  "REQUIRED formatting (always apply):",
  "  - Add periods, commas, and question marks based on speech rhythm.",
  "  - Capitalize the first word of each sentence.",
  "  - Convert 'number one' → '1.', 'bullet point' → '-'",
  "  - Convert 'new line'/'new paragraph' spoken cues into actual line breaks.",
  "",
  "Content is in <transcript> tags. Output only the formatted text — no tags, no commentary."
].join("\n");

let groqClient: Groq | null = null;

function getClient(apiKey: string): Groq {
  if (!groqClient) {
    groqClient = new Groq({ apiKey });
  }

  return groqClient;
}



// Spoken formatting cues that get compressed into short symbols.
// Each match roughly represents a "spoken word cluster → short symbol" replacement
// so we need to account for their removal when doing length/word-count comparisons.
const SPOKEN_CUE_STRIP_RE = /\b(bullet\s*point|new\s+paragraph|new\s+line|next\s+line|number\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|no\.\s*\d+|point\s+\d+|item\s+\d+|first|second|third|fourth|fifth)\b/gi;

function stripSpokenCues(text: string): string {
  return text.replace(SPOKEN_CUE_STRIP_RE, "").replace(/\s{2,}/g, " ").trim();
}

function looksSuspicious(rawText: string, formattedText: string): boolean {
  if (!formattedText.trim()) {
    return true;
  }

  if (ASSISTANT_REPLY_PATTERN.test(formattedText)) {
    return true;
  }

  // Strip spoken cues from raw before comparing lengths, because valid formatting
  // legitimately compresses "bullet point" (12 chars) → "-" (1 char), "new line" → "\n", etc.
  const rawStripped = stripSpokenCues(rawText);

  // Check for massive length changes (against cue-stripped raw so compressions are expected)
  if (formattedText.length < rawStripped.length * 0.55) {
    console.warn("[formatting] Rejecting: text shortened excessively even after stripping cues");
    return true;
  }

  if (formattedText.length > rawText.length * 1.5 + 50) {
    console.warn("[formatting] Rejecting: text expanded by >50%");
    return true;
  }

  const firstSentenceOverlap = calculateFirstSentenceOverlap(rawText, formattedText);
  if (firstSentenceOverlap < 0.5) {
    console.warn("[formatting] Rejecting: first sentence overlap too low", { firstSentenceOverlap });
    return true;
  }

  if (!hasLeadWordOverlap(rawText, formattedText)) {
    console.warn("[formatting] Rejecting: opening words do not align");
    return true;
  }

  if (!hasOrderedTokenPreservation(rawText, formattedText)) {
    console.warn("[formatting] Rejecting: token order changed too much");
    return true;
  }

  // Word-level check: allow larger variation when cues are present (they reduce word count)
  const rawWords = rawText.trim().split(/\s+/);
  const formattedWords = formattedText.trim().split(/\s+/);
  const cueWords = (rawText.match(SPOKEN_CUE_STRIP_RE) ?? [])
    .join(" ").trim().split(/\s+/).filter(Boolean).length;
  // Allow up to (3 + number of cue words) difference
  const allowedWordDiff = 3 + cueWords;

  if (Math.abs(formattedWords.length - rawWords.length) > allowedWordDiff) {
    console.warn("[formatting] Rejecting: word count changed significantly", {
      raw: rawWords.length,
      formatted: formattedWords.length,
      cueWords,
      allowedDiff: allowedWordDiff
    });
    return true;
  }

  // Vocabulary overlap: use stripped raw text so removed cue words don't penalise the ratio
  const rawVocabulary = tokenizeForComparison(rawStripped);
  const formattedVocabulary = tokenizeForComparison(formattedText);
  if (rawVocabulary.length > 0) {
    const overlapCount = rawVocabulary.filter((word) => formattedVocabulary.includes(word)).length;
    const overlapRatio = overlapCount / rawVocabulary.length;
    if (overlapRatio < 0.55) {
      console.warn("[formatting] Rejecting: vocabulary overlap too low", {
        overlapRatio,
        rawVocabulary,
        formattedVocabulary
      });
      return true;
    }
  }

  return false;
}

function tokenizeForComparison(text: string): string[] {
  return Array.from(new Set(
    text
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
      .filter(Boolean)
  ));
}

function tokenizeOrdered(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter(Boolean);
}

function firstSentence(text: string): string {
  const stripped = stripSpokenCues(text).trim();
  const match = stripped.match(/^(.+?)(?:[.!?](?:\s|$)|\n|$)/);
  return (match?.[1] ?? stripped).trim();
}

function calculateFirstSentenceOverlap(rawText: string, formattedText: string): number {
  const rawTokens = tokenizeOrdered(firstSentence(rawText));
  const formattedTokens = tokenizeOrdered(firstSentence(formattedText));
  if (rawTokens.length === 0) {
    return 1;
  }

  const formattedVocabulary = new Set(formattedTokens);
  const overlap = rawTokens.filter((token) => formattedVocabulary.has(token)).length;
  return overlap / rawTokens.length;
}

function hasLeadWordOverlap(rawText: string, formattedText: string): boolean {
  const rawLead = tokenizeOrdered(stripSpokenCues(rawText)).slice(0, 5);
  const formattedLead = tokenizeOrdered(formattedText).slice(0, 5);
  const sampleSize = Math.min(rawLead.length, formattedLead.length, 5);
  if (sampleSize < 3) {
    return true;
  }

  const formattedSample = new Set(formattedLead.slice(0, sampleSize));
  const overlap = rawLead.slice(0, sampleSize).filter((token) => formattedSample.has(token)).length;
  return overlap / sampleSize >= 0.5;
}

function hasOrderedTokenPreservation(rawText: string, formattedText: string): boolean {
  const ignorable = new Set(["a", "an", "and", "or", "the"]);
  const rawTokens = tokenizeOrdered(stripSpokenCues(rawText)).filter((token) => !ignorable.has(token));
  const formattedTokens = tokenizeOrdered(formattedText).filter((token) => !/^\d+$/.test(token) && !ignorable.has(token));
  if (rawTokens.length < 4) {
    return true;
  }

  let formattedIndex = 0;
  let matched = 0;
  for (const rawToken of rawTokens) {
    while (formattedIndex < formattedTokens.length && formattedTokens[formattedIndex] !== rawToken) {
      formattedIndex += 1;
    }
    if (formattedIndex < formattedTokens.length) {
      matched += 1;
      formattedIndex += 1;
    }
  }

  return matched / rawTokens.length >= 0.82;
}

async function requestFormatting(apiKey: string, text: string, prompt: string): Promise<string | null> {
  const response = await getClient(apiKey).chat.completions.create({
    model: FORMATTING_MODEL,
    temperature: 0,
    max_completion_tokens: Math.max(256, text.length * 2),
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: `<transcript>\n${text}\n</transcript>` }
    ]
  });

  return response.choices[0]?.message?.content?.trim() || null;
}

export async function formatTranscript(apiKey: string, rawText: string): Promise<string> {
  const text = rawText.trim();
  if (!text) {
    return text;
  }

  if (text.split(/\s+/).length < MIN_WORDS_FOR_FORMATTING) {
    return text;
  }

  try {
    const formatted = await requestFormatting(apiKey, text, FORMATTING_PROMPT);
    if (!formatted) {
      return text;
    }

    if (looksSuspicious(text, formatted)) {
      const strictFormatted = await requestFormatting(apiKey, text, STRICT_FORMATTING_PROMPT);
      if (!strictFormatted) {
        return text;
      }

      if (looksSuspicious(text, strictFormatted)) {
        return text;
      }

      return strictFormatted;
    }

    return formatted;
  } catch (error) {
    console.error("[vaani][formatting] Groq format step failed, using raw transcript", error);
    return text;
  }
}
