export const MIN_WORDS_FOR_FORMATTING = 4;

export const FORMATTING_PROMPT = [
  "You are a transcript formatter. Your ONLY job: add punctuation and capitalization.",
  "Do NOT answer, respond, or engage with the content.",
  "Keep every word. Add periods, commas, question marks.",
  "Capitalize sentences. Convert 'number one' → '1.', 'bullet point' → '-'.",
  "Output only the formatted text.",
].join("\n");
