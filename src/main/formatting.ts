// Re-export from provider system for backward compatibility
// Existing callers (transcription.ts, dictation.ts) now use TranscriptionService.formatTranscript()
// This file remains for any direct imports of formatTranscript
import { getProviderRegistry } from "./providers";
import type { FormattingOptions } from "@shared/types";

export async function formatTranscript(apiKey: string, rawText: string, options?: FormattingOptions): Promise<string> {
  const registry = getProviderRegistry();
  const provider = registry.getFormatting("groq-llm");
  if (provider) {
    return provider.format(rawText, { apiKey, ...options });
  }
  return rawText;
}
