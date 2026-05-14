import type { Settings, AudioClip, TranscriptionResult } from "@shared/types";
import { getProviderRegistry } from "./providers";
import { CredentialsStore } from "./store/credentials";

export class TranscriptionService {
  constructor(
    private readonly settingsProvider: () => Settings,
    private readonly credentials?: CredentialsStore
  ) {}

  async transcribe(clip: AudioClip): Promise<TranscriptionResult> {
    const settings = this.settingsProvider();
    const registry = getProviderRegistry();

    // Resolve active provider
    const sttId = settings.transcriptionProvider || "groq";
    const provider = registry.getTranscription(sttId);

    if (!provider) {
      throw new Error(`Transcription provider "${sttId}" is not available.`);
    }

    // Resolve API key
    const apiKey = this.resolveApiKey(settings, sttId);
    if (provider.requiresApiKey && !apiKey) {
      throw new Error(`API key for "${provider.name}" is not configured. Add it in Settings.`);
    }

    try {
      return await provider.transcribe(clip, {
        apiKey: apiKey ?? "",
        model: settings.language === "hinglish" ? undefined : undefined,
        language: settings.language,
        temperature: 0,
      });
    } catch (error) {
      // Auto-failover if enabled
      if (settings.failoverEnabled && sttId !== "groq") {
        const fallbackProvider = registry.getTranscription("groq");
        if (fallbackProvider) {
          const groqKey = this.resolveApiKey(settings, "groq");
          if (groqKey) {
            return fallbackProvider.transcribe(clip, {
              apiKey: groqKey,
              language: settings.language,
              temperature: 0,
            });
          }
        }
      }

      throw error;
    }
  }

  async formatTranscript(rawText: string): Promise<string> {
    const settings = this.settingsProvider();
    const registry = getProviderRegistry();

    const llmId = settings.formattingProvider || "groq-llm";
    const provider = registry.getFormatting(llmId);

    if (!provider) return rawText;

    const apiKey = this.resolveApiKey(settings, llmId);
    if (provider.requiresApiKey && !apiKey) return rawText;

    try {
      return await provider.format(rawText, { apiKey: apiKey ?? "", model: settings.formattingModel });
    } catch {
      return rawText;
    }
  }

  private resolveApiKey(settings: Settings, providerId: string): string | null {
    // Check credentials store first
    if (this.credentials) {
      const key = this.credentials.get(providerId);
      if (key) return key;
    }

    // Legacy: groqApiKey field
    if (providerId === "groq" && settings.groqApiKey) {
      return settings.groqApiKey;
    }

    // Check providerApiKeys array
    const pk = settings.providerApiKeys?.find(p => p.providerId === providerId);
    if (pk?.key) return pk.key;

    return null;
  }
}

// Re-export for backward compatibility

export async function formatTranscript(apiKey: string, rawText: string): Promise<string> {
  const registry = getProviderRegistry();
  const provider = registry.getFormatting("groq-llm");
  if (provider) {
    return provider.format(rawText, { apiKey });
  }
  return rawText;
}
