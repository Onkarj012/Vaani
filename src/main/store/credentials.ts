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

  getAll(): Array<Pick<CredentialEntry, "key">> {
    return Array.from(this.cache.keys()).map((key) => ({ key }));
  }

  migrateFromSettings(settings: Settings): Partial<Settings> {
    // Load keys from settings into in-memory cache.
    // Keys are NOT cleared from disk — settings.json is the persistence layer.
    if (settings.groqApiKey && !this.cache.has("groq")) {
      this.set("groq", settings.groqApiKey);
    }

    for (const pk of settings.providerApiKeys ?? []) {
      if (pk.key && !this.cache.has(pk.providerId)) {
        this.set(pk.providerId, pk.key);
      }
    }

    return {};
  }

  getApiKey(providerId: string, legacySettingsKey?: string): string | null {
    return this.get(providerId) ?? legacySettingsKey ?? null;
  }
}
