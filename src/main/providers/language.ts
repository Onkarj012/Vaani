import { isLanguageSupportedByProvider } from "@shared/defaults";

export { isLanguageSupportedByProvider };

const MAX_PROMPT_CHARS = 600;

// Whisper's `prompt` field is a text-prior, not an instruction field. Passing
// imperative instructions biases decoding and causes dropped or condensed output
// on longer audio. Only user-supplied vocabulary/context is safe here.
export function buildTranscriptionPrompt(_language: string | undefined, customPrompt: string | undefined): string {
  return (customPrompt?.trim() ?? "").slice(0, MAX_PROMPT_CHARS);
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

// Resolve the language a given provider/model should actually receive, honoring
// what each provider can support. Unsupported pairs fall back to auto-detect
// (undefined for Whisper-style, null for Deepgram) instead of silently passing
// a code the provider cannot use.
export function resolveLanguageForProvider(
  language: string | undefined,
  providerId: string,
  modelId?: string,
): string | null | undefined {
  const effective = language ?? "auto";
  if (providerId === "deepgram") {
    return isLanguageSupportedByProvider(effective, providerId) ? normalizeDeepgramLanguage(language) : null;
  }
  if (!isLanguageSupportedByProvider(effective, providerId, modelId)) return undefined;
  return normalizeWhisperLanguage(language);
}
