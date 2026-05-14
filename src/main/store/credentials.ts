import type { Settings } from "@shared/types";

interface CredentialEntry {
  key: string;
  value: string;
}

/**
 * CredentialsStore — in-memory credential cache.
 * API keys are stored in memory and persisted via the settings system.
 * For production keychain access, use a native macOS Keychain module or keytar.
 */
export class CredentialsStore {
  private cache = new Map<string, string>();

  get(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.cache.set(key, value);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  getAll(): CredentialEntry[] {
    return Array.from(this.cache.entries()).map(([key, value]) => ({ key, value }));
  }

  migrateFromSettings(settings: Settings): Partial<Settings> {
    const patch: Partial<Settings> = {};

    if (settings.groqApiKey && !this.cache.has("groq")) {
      this.set("groq", settings.groqApiKey);
      patch.groqApiKey = "";
    }

    for (const pk of settings.providerApiKeys ?? []) {
      if (pk.key && !this.cache.has(pk.providerId)) {
        this.set(pk.providerId, pk.key);
      }
    }

    if ((settings.providerApiKeys ?? []).length > 0) {
      patch.providerApiKeys = [];
    }

    return patch;
  }

  getApiKey(providerId: string, legacySettingsKey?: string): string | null {
    return this.get(providerId) ?? legacySettingsKey ?? null;
  }
}
