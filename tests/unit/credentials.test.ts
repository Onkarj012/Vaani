import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import { createExportPayload } from "@renderer/exportData";
import { CredentialsStore, MemoryCredentialBackend, sanitizeSettingsForRenderer } from "@main/store/credentials";

describe("CredentialsStore", () => {
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
      providerApiKeys: [{ providerId: "openai", key: "secret-openai" }],
    });

    expect(sanitized.groqApiKey).toBe("");
    expect(sanitized.providerApiKeys).toEqual([{ providerId: "openai", key: "" }]);
  });

  it("redacts credentials from export payloads", () => {
    const payload = createExportPayload({
      ...DEFAULT_SETTINGS,
      groqApiKey: "secret",
      providerApiKeys: [{ providerId: "anthropic", key: "secret-anthropic" }],
    }, []);

    expect(payload.settings.groqApiKey).toBe("");
    expect(payload.settings.providerApiKeys).toEqual([{ providerId: "anthropic", key: "" }]);
    expect(JSON.stringify(payload)).not.toContain("secret");
  });
});
