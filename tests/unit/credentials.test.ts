import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import { createExportPayload } from "@renderer/exportData";
import { CredentialsStore, MemoryCredentialBackend, sanitizeSettingsForRenderer } from "@main/store/credentials";
import { shouldSaveProviderKeyOnBlur } from "@renderer/lib/providerKeyDraft";
import { decideProviderKeyDraft } from "@renderer/lib/providerKeyDraft";
import { buildResetSettingsPatch } from "@renderer/lib/settingsReset";

describe("CredentialsStore", () => {
  it("treats a blank redacted key as untouched during blur or Cancel", () => {
    expect(shouldSaveProviderKeyOnBlur("")).toBe(false);
    expect(shouldSaveProviderKeyOnBlur("   ")).toBe(false);
    expect(shouldSaveProviderKeyOnBlur("replacement-key")).toBe(true);
    expect(decideProviderKeyDraft("replacement-key", "cancel")).toBe("preserve");
    expect(decideProviderKeyDraft("replacement-key", "blur")).toBe("save");
  });

  it("resets settings without dropping Keychain-backed provider metadata", () => {
    const reset = buildResetSettingsPatch({
      ...DEFAULT_SETTINGS,
      providerApiKeys: [{ providerId: "openai", key: "", hasKey: true, lastValidation: { valid: true, message: "valid", testedAt: "2026-09-01T00:00:00.000Z" } }],
    });
    expect(reset.providerApiKeys).toEqual([{ providerId: "openai", key: "", hasKey: true, lastValidation: { valid: true, message: "valid", testedAt: "2026-09-01T00:00:00.000Z" } }]);
    expect(JSON.stringify(reset)).not.toContain("secret");
  });
  it("migrates legacy settings keys into the credential backend and clears persisted fields", async () => {
    const backend = new MemoryCredentialBackend();
    const store = new CredentialsStore(backend);
    const patch = await store.migrateFromSettings({
      ...DEFAULT_SETTINGS,
      groqApiKey: "legacy-groq-key",
      providerApiKeys: [
        { providerId: "openai", key: "legacy-openai-key" },
        { providerId: "deepgram", key: "" },
      ],
    });

    expect(await backend.get("groq")).toBe("legacy-groq-key");
    expect(await backend.get("openai")).toBe("legacy-openai-key");
    expect(patch).toEqual({
      groqApiKey: "",
      providerApiKeys: [
        { providerId: "openai", key: "" },
        { providerId: "deepgram", key: "" },
      ],
    });
  });

  it("redacts credentials before settings leave the main process", () => {
    const sanitized = sanitizeSettingsForRenderer({
      ...DEFAULT_SETTINGS,
      groqApiKey: "secret",
      providerApiKeys: [{
        providerId: "openai",
        key: "secret-openai",
        lastValidation: { valid: true, message: "OpenAI API key is valid.", testedAt: "2026-09-01T00:00:00.000Z" },
      }],
    });

    expect(sanitized.groqApiKey).toBe("");
    expect(sanitized.providerApiKeys).toEqual([{
      providerId: "openai",
      key: "",
      hasKey: true,
      lastValidation: { valid: true, message: "OpenAI API key is valid.", testedAt: "2026-09-01T00:00:00.000Z" },
    }]);
    expect(JSON.stringify(sanitized)).not.toContain("secret-openai");
  });

  it("has() returns true after set and false for unknown key", async () => {
    const backend = new MemoryCredentialBackend();
    const store = new CredentialsStore(backend);
    expect(await store.has("groq")).toBe(false);
    await store.set("groq", "gsk_secret");
    expect(await store.has("groq")).toBe(true);
    await store.delete("groq");
    expect(await store.has("groq")).toBe(false);
  });

  it("redacts credentials from export payloads", () => {
    const payload = createExportPayload({
      ...DEFAULT_SETTINGS,
      groqApiKey: "secret",
      providerApiKeys: [{ providerId: "anthropic", key: "secret-anthropic" }],
    }, [{
      id: "history-1",
      timestamp: "2026-09-01T00:00:00.000Z",
      rawText: "text ".repeat(200),
      formattedText: "text ".repeat(200),
      cleanedText: "text ".repeat(200),
      durationSeconds: 1,
      appBundleId: null,
      appName: null,
      injectionStatus: "saved",
      injectionMethod: null,
      language: "en",
      rawAudioPath: "/private/raw.wav",
    }]);

    expect(payload.settings.groqApiKey).toBe("");
    expect(payload.settings.providerApiKeys).toEqual([{
      providerId: "anthropic",
      key: "",
      hasKey: true,
      lastValidation: null,
    }]);
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(payload.history[0]?.rawAudioPath).toBeNull();
    expect(payload.history[0]?.cleanedText.length).toBeLessThanOrEqual(500);
  });
});
