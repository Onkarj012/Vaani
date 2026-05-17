import type { Settings, AudioClip, TranscriptionResult } from "@shared/types";
import { getProviderRegistry } from "./providers";
import type { TranscriptionProvider } from "./providers/types";
import { CredentialsStore } from "./store/credentials";

export class TranscriptionService {
  constructor(
    private readonly settingsProvider: () => Settings,
    private readonly credentials?: CredentialsStore
  ) {}

  async transcribe(clip: AudioClip): Promise<TranscriptionResult> {
    const settings = this.settingsProvider();
    const registry = getProviderRegistry();
    const primaryId = settings.transcriptionProvider || "groq";

    const chain = this.buildSttChain(settings, primaryId, registry);
    if (chain.length === 0) {
      const hasKey = this.resolveApiKey(settings, primaryId);
      const provider = registry.getTranscription(primaryId);
      console.error(`[vaani] No providers in chain. primary=${primaryId}, providerExists=${!!provider}, hasKey=${!!hasKey}`);
      throw new Error(`Transcription provider "${primaryId}" is not available or has no API key configured. Check Settings → API & Providers.`);
    }

    console.log(`[vaani] Transcription chain: ${chain.map(c => c.id).join(" → ")}`);

    let lastError: Error = new Error("All transcription providers failed.");
    for (const { id, provider, apiKey } of chain) {
      try {
        return await provider.transcribe(clip, { apiKey, language: settings.language, temperature: 0 });
      } catch (error) {
        if (isAuthError(error)) {
          console.error(`[vaani] Auth error from "${id}":`, error);
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[vaani] STT provider "${id}" failed:`, lastError.message);
        if (!settings.failoverEnabled || chain.length === 1) throw lastError;
      }
    }

    throw lastError;
  }

  private buildSttChain(
    settings: Settings,
    primaryId: string,
    registry: ReturnType<typeof getProviderRegistry>
  ): { id: string; provider: TranscriptionProvider; apiKey: string }[] {
    const chain: { id: string; provider: TranscriptionProvider; apiKey: string }[] = [];

    const tryAdd = (id: string) => {
      if (chain.some(e => e.id === id)) return;
      const provider = registry.getTranscription(id);
      if (!provider) {
        console.log(`[vaani] buildSttChain: provider "${id}" not found in registry`);
        return;
      }
      const apiKey = this.resolveApiKey(settings, id);
      if (provider.requiresApiKey && !apiKey) {
        console.log(`[vaani] buildSttChain: provider "${id}" requires API key but none found`);
        return;
      }
      chain.push({ id, provider, apiKey: apiKey ?? "" });
    };

    tryAdd(primaryId);

    if (settings.failoverEnabled) {
      for (const fallbackId of ["groq", "openai", "deepgram"]) {
        if (fallbackId !== primaryId) tryAdd(fallbackId);
      }
    }

    return chain;
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
      if (key) {
        console.log(`[vaani] resolveApiKey("${providerId}"): found in credentials store`);
        return key;
      }
    }

    // Legacy: groqApiKey field
    if (providerId === "groq" && settings.groqApiKey) {
      console.log(`[vaani] resolveApiKey("${providerId}"): found in settings.groqApiKey`);
      return settings.groqApiKey;
    }

    // Check providerApiKeys array
    const pk = settings.providerApiKeys?.find(p => p.providerId === providerId);
    if (pk?.key) {
      console.log(`[vaani] resolveApiKey("${providerId}"): found in providerApiKeys`);
      return pk.key;
    }

    console.log(`[vaani] resolveApiKey("${providerId}"): NOT FOUND (credentials=${!!this.credentials}, groqApiKey=${!!settings.groqApiKey}, providerApiKeys=${JSON.stringify(settings.providerApiKeys?.map(p => p.providerId))})`);
    return null;
  }
}

function isAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("authentication") || msg.includes("invalid api key") || msg.includes("incorrect api key");
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
