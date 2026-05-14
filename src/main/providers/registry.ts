import type { TranscriptionProvider, FormattingProvider } from "./types";
import { KNOWN_PROVIDERS, type ProviderInfo } from "@shared/defaults";

export class ProviderRegistry {
  private transcriptionProviders = new Map<string, TranscriptionProvider>();
  private formattingProviders = new Map<string, FormattingProvider>();
  private activeTranscriptionId = "groq";
  private activeFormattingId = "groq-llm";

  registerTranscription(provider: TranscriptionProvider): void {
    this.transcriptionProviders.set(provider.id, provider);
  }

  registerFormatting(provider: FormattingProvider): void {
    this.formattingProviders.set(provider.id, provider);
  }

  setActiveTranscription(id: string): void {
    this.activeTranscriptionId = id;
  }

  setActiveFormatting(id: string): void {
    this.activeFormattingId = id;
  }

  getActiveTranscription(): TranscriptionProvider | undefined {
    return this.transcriptionProviders.get(this.activeTranscriptionId);
  }

  getActiveFormatting(): FormattingProvider | undefined {
    return this.formattingProviders.get(this.activeFormattingId);
  }

  getTranscription(id: string): TranscriptionProvider | undefined {
    return this.transcriptionProviders.get(id);
  }

  getFormatting(id: string): FormattingProvider | undefined {
    return this.formattingProviders.get(id);
  }

  listTranscriptionProviders(): TranscriptionProvider[] {
    return Array.from(this.transcriptionProviders.values());
  }

  listFormattingProviders(): FormattingProvider[] {
    return Array.from(this.formattingProviders.values());
  }

  getAllProviderMetadata(): ProviderInfo[] {
    return KNOWN_PROVIDERS;
  }

  async getProviderStatus(): Promise<{ id: string; name: string; available: boolean; configured: boolean; type: string }[]> {
    const results: { id: string; name: string; available: boolean; configured: boolean; type: string }[] = [];

    for (const t of this.transcriptionProviders.values()) {
      results.push({
        id: t.id,
        name: t.name,
        available: await t.isAvailable(),
        configured: !t.requiresApiKey, // will be updated by caller
        type: "stt",
      });
    }

    for (const f of this.formattingProviders.values()) {
      results.push({
        id: f.id,
        name: f.name,
        available: await f.isAvailable(),
        configured: !f.requiresApiKey,
        type: "llm",
      });
    }

    return results;
  }
}
