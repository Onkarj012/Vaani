import { describe, expect, it } from "vitest";
import { RecoveryKeyAccessError, RecoveryKeyStore, type RecoveryKeychainBackend } from "@main/keychain";

describe("RecoveryKeyStore", () => {
  it("serializes first creation across store instances and returns the saved key", async () => {
    let stored: string | null = null;
    let writes = 0;
    const backend: RecoveryKeychainBackend = {
      async get() { return stored; },
      async set(_service, _account, value) {
        writes += 1;
        await Promise.resolve();
        stored = value;
      },
    };
    const [first, second] = await Promise.all([
      new RecoveryKeyStore(backend).getOrCreate(false),
      new RecoveryKeyStore(backend).getOrCreate(false),
    ]);
    expect(writes).toBe(1);
    expect(first).toEqual(second);
    expect(first.toString("base64")).toBe(stored);
  });

  it("does not carry backend errors that may contain the key", async () => {
    const backend: RecoveryKeychainBackend = {
      async get() { return null; },
      async set() { throw new Error("security -w exposed-secret"); },
    };
    await expect(new RecoveryKeyStore(backend).getOrCreate(false)).rejects.toMatchObject({
      name: RecoveryKeyAccessError.name,
      message: "Could not store recovery key.",
    });
  });
});
