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
      throw new RecoveryKeyAccessError(message || "Could not access recovery key.");
    }
  }

  async set(service: string, account: string, value: string): Promise<void> {
    try {
      await execFileAsync("security", ["add-generic-password", "-U", "-s", service, "-a", account, "-w", value]);
    } catch (error) {
      throw new RecoveryKeyAccessError(error instanceof Error ? error.message : "Could not store recovery key.");
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
    let stored: string | null;
    try {
      stored = await this.backend.get(RECOVERY_KEYCHAIN_SERVICE, RECOVERY_KEYCHAIN_ACCOUNT);
    } catch (error) {
      throw new RecoveryKeyAccessError(error instanceof Error ? error.message : "Could not access recovery key.");
    }
    if (stored === null) {
      if (ciphertextExists) throw new RecoveryKeyMissingError();
      const generated = randomBytes(RECOVERY_KEY_BYTES);
      await this.backend.set(RECOVERY_KEYCHAIN_SERVICE, RECOVERY_KEYCHAIN_ACCOUNT, generated.toString("base64"));
      return generated;
    }

    const decoded = Buffer.from(stored, "base64");
    if (decoded.length !== RECOVERY_KEY_BYTES || decoded.toString("base64") !== stored) {
      throw new RecoveryKeyCorruptError();
    }
    return decoded;
  }
}
