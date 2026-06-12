const LANGUAGE_CONTEXT: Record<string, string> = {
  auto: "Transcribe the speech exactly in the language or languages spoken. Preserve the original script, names, punctuation, and mixed-language phrasing. Do not translate to English.",
  en: "This is English dictation. Preserve names, product terms, punctuation, and sentence structure.",
  hi: "यह हिंदी डिक्टेशन है। हिंदी को देवनागरी लिपि में लिखें। नामों, तकनीकी शब्दों और विराम चिह्नों को सही रखें। अंग्रेज़ी में अनुवाद न करें।",
  hinglish: "This is Hinglish dictation with mixed Hindi and English. Preserve the user's natural mix of Roman Hindi, English words, and proper nouns. Do not force everything into English or Devanagari.",
  ta: "This is Tamil dictation. Preserve Tamil script, names, punctuation, and any mixed English terms. Do not translate to English.",
  pa: "This is Punjabi dictation. Preserve the spoken language, names, punctuation, and any mixed English terms. Do not translate to English.",
  mr: "This is Marathi dictation. Preserve Devanagari script, names, punctuation, and any mixed English terms. Do not translate to English.",
  bn: "This is Bengali dictation. Preserve Bengali script, names, punctuation, and any mixed English terms. Do not translate to English.",
  gu: "This is Gujarati dictation. Preserve Gujarati script, names, punctuation, and any mixed English terms. Do not translate to English.",
  te: "This is Telugu dictation. Preserve Telugu script, names, punctuation, and any mixed English terms. Do not translate to English.",
  kn: "This is Kannada dictation. Preserve Kannada script, names, punctuation, and any mixed English terms. Do not translate to English.",
  ml: "This is Malayalam dictation. Preserve Malayalam script, names, punctuation, and any mixed English terms. Do not translate to English.",
};

export function buildTranscriptionPrompt(language: string | undefined, customPrompt: string | undefined): string {
  const basePrompt = LANGUAGE_CONTEXT[language || "auto"] ?? LANGUAGE_CONTEXT.auto;
  return [basePrompt, customPrompt?.trim() ?? ""].filter(Boolean).join("\n");
}

export function normalizeWhisperLanguage(language: string | undefined): string | undefined {
  if (!language || language === "auto" || language === "hinglish") return undefined;
  return language;
}

export function normalizeDeepgramLanguage(language: string | undefined): string | null {
  if (!language || language === "auto" || language === "hinglish") return null;
  if (language === "zh") return "zh-CN";
  return language;
}

export function resolveReportedLanguage(language: string | undefined): string | null {
  if (!language || language === "auto") return null;
  return language;
}
