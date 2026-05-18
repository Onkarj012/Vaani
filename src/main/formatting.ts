// Re-export from provider system for backward compatibility
// Existing callers (transcription.ts, dictation.ts) now use TranscriptionService.formatTranscript()
// This file remains for any direct imports of formatTranscript
import { getProviderRegistry } from "./providers";

export async function formatTranscript(apiKey: string, rawText: string): Promise<string> {
  const registry = getProviderRegistry();
  const provider = registry.getFormatting("groq-llm");
  if (provider) {
    return provider.format(rawText, { apiKey });
  }
  return rawText;
}
