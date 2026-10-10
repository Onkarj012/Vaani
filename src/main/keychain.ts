import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

export const RECOVERY_KEY_VERSION = 1;
export const RECOVERY_KEYCHAIN_SERVICE = `app.vaani.recovery.audio.v${RECOVERY_KEY_VERSION}`;
export const RECOVERY_KEYCHAIN_ACCOUNT = "session-encryption-key";
export const RECOVERY_KEY_BYTES = 32;

export interface RecoveryKeychainBackend {
  get(service: string, account: string): Promise<string | null>;
  set(service: string, account: string, value: string): Promise<void>;
}

const execFileAsync = promisify(execFile);
let pendingKeyCreation: Promise<void> = Promise.resolve();

export class RecoveryKeyAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryKeyAccessError";
  }
}

export class RecoveryKeyMissingError extends RecoveryKeyAccessError {
  constructor() {
    super("Recovery audio encryption key is missing.");
    this.name = "RecoveryKeyMissingError";
  }
}

export class RecoveryKeyCorruptError extends RecoveryKeyAccessError {
  constructor() {
    super("Recovery audio encryption key is corrupt.");
    this.name = "RecoveryKeyCorruptError";
  }
}

export class MacOSRecoveryKeychainBackend implements RecoveryKeychainBackend {
  async get(service: string, account: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", service, "-a", account, "-w"]);
      return stdout.replace(/\n$/, "");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/could not be found|item not found|no such item/i.test(message)) return null;
      throw new RecoveryKeyAccessError("Could not access recovery key.");
    }
  }

  async set(service: string, account: string, value: string): Promise<void> {
    try {
      // security help documents -w without a value as a prompt, not a noninteractive stdin contract.
      await execFileAsync("security", ["add-generic-password", "-U", "-s", service, "-a", account, "-w", value]);
    } catch (error) {
      throw new RecoveryKeyAccessError("Could not store recovery key.");
    }
  }
}

export class MemoryRecoveryKeychainBackend implements RecoveryKeychainBackend {
  private readonly values = new Map<string, string>();

  async get(service: string, account: string): Promise<string | null> {
    return this.values.get(`${service}:${account}`) ?? null;
  }

  async set(service: string, account: string, value: string): Promise<void> {
    this.values.set(`${service}:${account}`, value);
  }
}

export class RecoveryKeyStore {
  constructor(private readonly backend: RecoveryKeychainBackend = new MacOSRecoveryKeychainBackend()) {}

  async getOrCreate(ciphertextExists: boolean): Promise<Buffer> {
    const stored = await this.readStored();
    if (stored !== null) return decodeKey(stored);
    if (ciphertextExists) throw new RecoveryKeyMissingError();

    const previous = pendingKeyCreation;
    let release: () => void = () => undefined;
    pendingKeyCreation = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const current = await this.readStored();
      if (current !== null) return decodeKey(current);
      const generated = randomBytes(RECOVERY_KEY_BYTES);
      try {
        await this.backend.set(RECOVERY_KEYCHAIN_SERVICE, RECOVERY_KEYCHAIN_ACCOUNT, generated.toString("base64"));
      } catch {
        throw new RecoveryKeyAccessError("Could not store recovery key.");
      }
      const saved = await this.readStored();
      if (saved === null) throw new RecoveryKeyMissingError();
      return decodeKey(saved);
    } finally {
      release();
    }
  }

  private async readStored(): Promise<string | null> {
    let stored: string | null;
    try {
      stored = await this.backend.get(RECOVERY_KEYCHAIN_SERVICE, RECOVERY_KEYCHAIN_ACCOUNT);
    } catch {
      throw new RecoveryKeyAccessError("Could not access recovery key.");
    }
    return stored;
  }
}

function decodeKey(stored: string): Buffer {
  const decoded = Buffer.from(stored, "base64");
  if (decoded.length !== RECOVERY_KEY_BYTES || decoded.toString("base64") !== stored) throw new RecoveryKeyCorruptError();
  return decoded;
}
