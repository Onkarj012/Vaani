import type { DictationContentGuardVerdict, DictationFormatterUsed, ProviderAttemptTrace, Settings, AudioClip, TranscriptionResult } from "@shared/types";
import { getProviderRegistry } from "./providers";
import type { TranscriptionProvider } from "./providers/types";
import { CredentialsStore } from "./store/credentials";
import { debug, warn } from "@main/log";
import { missingContentWords } from "@shared/contentGuard";

interface TranscribeOptions {
  languageOverride?: string;
  providerOverride?: string;
  rejectResult?: (result: TranscriptionResult) => boolean;
  retryClip?: AudioClip;
}

export interface FormatTranscriptTraceResult {
  text: string;
  formatterUsed: DictationFormatterUsed;
  contentGuardVerdict?: DictationContentGuardVerdict;
}

export class TranscriptionService {
  constructor(
    private readonly settingsProvider: () => Settings,
    private readonly credentials?: CredentialsStore
  ) {}

  async transcribe(clip: AudioClip, options?: TranscribeOptions): Promise<TranscriptionResult> {
    const settings = this.settingsProvider();
    const registry = getProviderRegistry();
    const primaryId = options?.providerOverride || settings.transcriptionProvider || "groq";
    const speechContextPrompt = buildSpeechContextPrompt(settings);

    const chain = await this.buildSttChain(settings, primaryId, registry);
    if (chain.length === 0) {
      throw new Error(messageForEmptyChain(settings, primaryId));
    }

    debug("transcription", `Chain: ${chain.map(c => c.id).join(" → ")}`);

    const language = options?.languageOverride ?? settings.language;
    let lastError: Error = new Error("All transcription providers failed.");
    let lastRejectedResult: TranscriptionResult | null = null;
    const providerAttempts: ProviderAttemptTrace[] = [];
    for (let providerIndex = 0; providerIndex < chain.length; providerIndex += 1) {
      const { id, provider, apiKey } = chain[providerIndex]!;
      const clips = options?.retryClip ? [clip, options.retryClip] : [clip];
      for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
        const startedAt = Date.now();
        try {
          const result = await provider.transcribe(clips[clipIndex]!, {
            apiKey,
            language,
            prompt: speechContextPrompt,
            temperature: 0
          });
          const quality = {
            ...result.quality,
            provider: result.quality?.provider ?? id,
            attemptCount: providerAttempts.length + 1,
            supportsConfidence: result.quality?.supportsConfidence ?? false,
            transcriptLength: result.rawText.length,
          };
          const withQuality: TranscriptionResult = {
            ...result,
            quality,
          };
          providerAttempts.push({ provider: id, success: true, latencyMs: Date.now() - startedAt, quality });
          if (options?.rejectResult?.(withQuality)) {
            lastRejectedResult = withQuality;
            const canRetrySameProvider = clipIndex === 0 && clips.length > 1;
            if (canRetrySameProvider) {
              warn("transcription", `Provider "${id}" returned suspicious transcript; retrying with untrimmed audio`);
              continue;
            }
            if (settings.failoverEnabled && providerIndex < chain.length - 1) {
              warn("transcription", `Provider "${id}" returned suspicious transcript; trying next provider`);
              break;
            }
          }
          return {
            ...withQuality,
            quality: {
              ...quality,
              attemptCount: providerAttempts.length,
            },
            providerAttempts,
          };
        } catch (error) {
          if (isAuthError(error)) {
            throw error;
          }
          lastError = error instanceof Error ? error : new Error(String(error));
          providerAttempts.push({ provider: id, success: false, latencyMs: Date.now() - startedAt, error: lastError.message });
          warn("transcription", `Provider "${id}" failed: ${lastError.message}`);
          if (!settings.failoverEnabled || chain.length === 1) throw lastError;
          break;
        }
      }
    }

    if (lastRejectedResult) return { ...lastRejectedResult, providerAttempts };
    throw lastError;
  }

  private async buildSttChain(
    settings: Settings,
    primaryId: string,
    registry: ReturnType<typeof getProviderRegistry>
  ): Promise<{ id: string; provider: TranscriptionProvider; apiKey: string }[]> {
    const chain: { id: string; provider: TranscriptionProvider; apiKey: string }[] = [];
    const offlineMode = settings.offlineMode ?? "auto";

    const tryAdd = async (id: string) => {
      if (chain.some(e => e.id === id)) return;
      if (offlineMode === "always-offline" && id !== "local-whisper") return;
      if (offlineMode === "always-online" && id === "local-whisper") return;
      const provider = registry.getTranscription(id);
      if (!provider) {
        return;
      }
      const apiKey = await this.resolveApiKey(settings, id);
      if (provider.requiresApiKey && !apiKey) {
        return;
      }
      chain.push({ id, provider, apiKey: apiKey ?? "" });
    };

    if (offlineMode === "always-offline") {
      await tryAdd("local-whisper");
      return chain;
    }

    await tryAdd(primaryId);

    if (settings.failoverEnabled) {
      for (const fallbackId of ["groq", "openai", "deepgram", "local-whisper"]) {
        if (fallbackId !== primaryId) await tryAdd(fallbackId);
      }
    }

    return chain;
  }

  async formatTranscript(rawText: string): Promise<string> {
    return (await this.formatTranscriptDetailed(rawText)).text;
  }

  async formatTranscriptDetailed(rawText: string): Promise<FormatTranscriptTraceResult> {
    const settings = this.settingsProvider();
    const registry = getProviderRegistry();

    const llmId = settings.formattingProvider || "groq-llm";
    const provider = registry.getFormatting(llmId);

    if (!provider) return { text: rawText, formatterUsed: "none" };

    const apiKey = await this.resolveApiKey(settings, llmId);
    if (provider.requiresApiKey && !apiKey) return { text: rawText, formatterUsed: "none" };

    try {
      const formatted = await provider.format(rawText, {
        apiKey: apiKey ?? "",
        model: settings.formattingModel,
        systemPrompt: settings.customPrompt
      });
      const missingWords = missingContentWords(rawText, formatted);
      if (missingWords.length > 0) {
        debug("transcription", "Content guard rejected LLM output — falling back to raw transcript cleanup");
        return {
          text: rawText,
          formatterUsed: "guard-fallback",
          contentGuardVerdict: { passed: false, missingWords },
        };
      }
      return {
        text: formatted,
        formatterUsed: "llm",
        contentGuardVerdict: { passed: true },
      };
    } catch {
      return { text: rawText, formatterUsed: "none" };
    }
  }

  private async resolveApiKey(settings: Settings, providerId: string): Promise<string | null> {
    const candidateIds = providerId === "groq-llm" ? ["groq-llm", "groq"] : [providerId];

    if (this.credentials) {
      for (const id of candidateIds) {
        const key = await this.credentials.get(id);
        if (key) return key;
      }
    }

    if ((providerId === "groq" || providerId === "groq-llm") && settings.groqApiKey) {
      return settings.groqApiKey;
    }

    const pk = settings.providerApiKeys?.find(p => p.providerId === providerId);
    if (pk?.key) return pk.key;

    return null;
  }
}

function messageForEmptyChain(settings: Settings, primaryId: string): string {
  if (settings.offlineMode === "always-offline") {
    return "Offline mode is enabled, but Local Whisper is not available. Go to Settings → Offline Mode to download or load a model.";
  }
  return `Transcription provider "${primaryId}" is not available or has no API key configured. Check Settings → API & Providers.`;
}

function isAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("authentication") || msg.includes("invalid api key") || msg.includes("incorrect api key");
}

const MAX_SPEECH_CONTEXT_CHARS = 600;
const MAX_SPEECH_CONTEXT_ITEMS = 24;

export function buildSpeechContextPrompt(
  settings: Pick<Settings, "customCorrections" | "snippets">,
): string | undefined {
  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined) => {
    const term = normalizeSpeechContextTerm(value);
    if (!term) return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(term);
  };

  for (const correction of settings.customCorrections ?? []) {
    add(correction.written);
  }

  for (const snippet of settings.snippets ?? []) {
    add(snippet.content);
  }

  let prompt = "";
  for (const term of terms.slice(0, MAX_SPEECH_CONTEXT_ITEMS)) {
    const next = prompt ? `${prompt}, ${term}` : term;
    if (next.length > MAX_SPEECH_CONTEXT_CHARS) break;
    prompt = next;
  }

  return prompt || undefined;
}

function normalizeSpeechContextTerm(value: string | undefined): string | null {
  const term = value?.replace(/\s+/g, " ").trim();
  if (!term || term.length < 2 || term.length > 40) return null;
  if (/\d/.test(term)) return null;
  if (term.split(/\s+/).length > 3) return null;
  return term;
}

// Re-export for backward compatibility
export { formatTranscript } from "./formatting";
