import type { Settings } from "@shared/types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

interface CredentialEntry {
  key: string;
}

export interface CredentialBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  listKeys(): Promise<string[]>;
}

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "app.vaani.credentials";

export class MemoryCredentialBackend implements CredentialBackend {
  private readonly cache = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.cache.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.cache.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async listKeys(): Promise<string[]> {
    return Array.from(this.cache.keys());
  }
}

export class MacOSKeychainCredentialBackend implements CredentialBackend {
  private knownKeys = new Set<string>();

  async get(key: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", key, "-w"]);
      this.knownKeys.add(key);
      return stdout.replace(/\n$/, "");
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await execFileAsync("security", ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", key, "-w", value]);
    this.knownKeys.add(key);
  }

  async delete(key: string): Promise<void> {
    try {
      await execFileAsync("security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", key]);
    } catch {
      // Deleting a missing key is idempotent for callers.
    }
    this.knownKeys.delete(key);
  }

  async listKeys(): Promise<string[]> {
    return Array.from(this.knownKeys);
  }
}

export class CredentialsStore {
  private cache = new Map<string, string>();

  constructor(private readonly backend: CredentialBackend = new MacOSKeychainCredentialBackend()) {}

  async get(key: string): Promise<string | null> {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const stored = await this.backend.get(key);
    if (stored) this.cache.set(key, stored);
    return stored;
  }

  async set(key: string, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      await this.delete(key);
      return;
    }
    await this.backend.set(key, trimmed);
    this.cache.set(key, trimmed);
  }

  async delete(key: string): Promise<void> {
    await this.backend.delete(key);
    this.cache.delete(key);
  }

  async getAll(): Promise<Array<Pick<CredentialEntry, "key">>> {
    const keys = new Set([...this.cache.keys(), ...(await this.backend.listKeys())]);
    return Array.from(keys).map((key) => ({ key }));
  }

  async migrateFromSettings(settings: Settings): Promise<Partial<Settings>> {
    const patch: Partial<Settings> = {};

    if (settings.groqApiKey && !this.cache.has("groq")) {
      await this.set("groq", settings.groqApiKey);
      patch.groqApiKey = "";
    }

    const sanitizedProviderKeys = [];
    for (const pk of settings.providerApiKeys ?? []) {
      if (pk.key && !this.cache.has(pk.providerId)) {
        await this.set(pk.providerId, pk.key);
      }
      sanitizedProviderKeys.push({ providerId: pk.providerId, key: "" });
    }
    if (settings.providerApiKeys?.some((pk) => pk.key)) {
      patch.providerApiKeys = sanitizedProviderKeys;
    }

    return patch;
  }

  async getApiKey(providerId: string, legacySettingsKey?: string): Promise<string | null> {
    return (await this.get(providerId)) ?? legacySettingsKey ?? null;
  }
}

export function sanitizeSettingsForRenderer(settings: Settings): Settings {
  return {
    ...settings,
    groqApiKey: "",
    providerApiKeys: (settings.providerApiKeys ?? []).map((pk) => ({ providerId: pk.providerId, key: "" })),
  };
}
