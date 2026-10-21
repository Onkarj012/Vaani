/** A blank redacted renderer value means "leave the saved credential alone". */
export function shouldSaveProviderKeyOnBlur(value: string): boolean {
  return value.trim().length > 0;
}

export type ProviderKeyExit = "blur" | "cancel";
export type ProviderKeyDraftDecision = "preserve" | "save";

export function decideProviderKeyDraft(value: string, exit: ProviderKeyExit): ProviderKeyDraftDecision {
  return exit === "cancel" || !shouldSaveProviderKeyOnBlur(value) ? "preserve" : "save";
}

// Providers whose cleanup key onboarding never asks for. OpenRouter is asked for unless transcription already uses its key.
const ONBOARDING_SKIPPED_LLM_KEYS = new Set(["openai-llm", "groq-llm"]);

/** True when onboarding must collect a separate key for the cleanup provider. */
export function onboardingNeedsLlmKey(formattingProvider: string | undefined, transcriptionProvider: string, requiresApiKey: boolean): boolean {
  if (!requiresApiKey || !formattingProvider) return false;
  if (formattingProvider === "openrouter") return transcriptionProvider !== "openrouter";
  return !ONBOARDING_SKIPPED_LLM_KEYS.has(formattingProvider);
}
