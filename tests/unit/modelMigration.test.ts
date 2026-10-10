import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import { defaultModelFor } from "@shared/modelList";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => `/tmp/vaani-test/${name}`,
  },
}));

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

async function loadWithStoredSettings(stored: Record<string, unknown>) {
  tempDir = await mkdtemp(join(tmpdir(), "vaani-model-migration-"));
  const filePath = join(tempDir, "settings.json");
  await writeFile(filePath, JSON.stringify(stored));
  const { SettingsStore } = await import("@main/store/settings");
  const store = new SettingsStore(filePath);
  await store.init();
  return { store, filePath };
}

describe("model settings migration", () => {
  it("moves a retired cleanup model to OpenRouter and swaps a retired transcription model for its default", async () => {
    const { store, filePath } = await loadWithStoredSettings({
      formattingProvider: "groq-llm",
      formattingModel: "llama-3.1-8b-instant",
      transcriptionProvider: "groq",
      transcriptionModel: "whisper-large-v3",
    });

    expect(store.get()).toMatchObject({
      formattingProvider: "openrouter",
      formattingModel: "anthropic/claude-haiku-5.5",
      transcriptionModel: "whisper-large-v3-turbo",
    });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      formattingProvider: "openrouter",
      formattingModel: "anthropic/claude-haiku-5.5",
      transcriptionModel: "whisper-large-v3-turbo",
    });
  });

  it("moves a retired Anthropic cleanup model to OpenRouter", async () => {
    const { store } = await loadWithStoredSettings({
      formattingProvider: "anthropic",
      formattingModel: "claude-3-5-sonnet-latest",
    });

    expect(store.get()).toMatchObject({ formattingProvider: "openrouter", formattingModel: "anthropic/claude-haiku-5.5" });
  });

  it("moves a cleanup choice with a missing provider to OpenRouter", async () => {
    const { store } = await loadWithStoredSettings({ formattingModel: "openai/gpt-6-luna" });

    expect(store.get()).toMatchObject({ formattingProvider: "openrouter", formattingModel: "anthropic/claude-haiku-5.5" });
  });

  it("keeps a valid OpenRouter cleanup choice", async () => {
    const { store } = await loadWithStoredSettings({
      formattingProvider: "openrouter",
      formattingModel: "openai/gpt-6-luna",
    });

    expect(store.get()).toMatchObject({ formattingProvider: "openrouter", formattingModel: "openai/gpt-6-luna" });
  });

  it("gives a new install OpenRouter cleanup with Haiku 5.5", async () => {
    const { store } = await loadWithStoredSettings({});

    expect(store.get()).toMatchObject({ formattingProvider: "openrouter", formattingModel: "anthropic/claude-haiku-5.5" });
  });

  it("keeps a current model that its provider lists", async () => {
    const { store } = await loadWithStoredSettings({
      formattingProvider: "openai-llm",
      formattingModel: "gpt-6-luna",
    });

    expect(store.get()).toMatchObject({ formattingProvider: "openai-llm", formattingModel: "gpt-6-luna" });
  });

  it("leaves a provider without a model list alone", async () => {
    const { store } = await loadWithStoredSettings({
      transcriptionProvider: "deepgram",
      transcriptionModel: "nova-2",
    });

    expect(store.get()).toMatchObject({ transcriptionProvider: "deepgram", transcriptionModel: "nova-2" });
  });

  it("is idempotent: a second load changes nothing and does not rewrite the file", async () => {
    const { filePath } = await loadWithStoredSettings({
      formattingProvider: "groq-llm",
      formattingModel: "llama-3.3-70b-versatile",
    });
    const afterFirstLoad = await readFile(filePath, "utf8");

    const { SettingsStore } = await import("@main/store/settings");
    const reloaded = new SettingsStore(filePath);
    await reloaded.init();

    expect(reloaded.get()).toMatchObject({ formattingProvider: "openrouter", formattingModel: "anthropic/claude-haiku-5.5" });
    expect(await readFile(filePath, "utf8")).toBe(afterFirstLoad);
  });

  it.each(["local-whisper", "openai-compatible"])("moves hidden %s transcription to the default provider and model", async (hiddenProvider) => {
    const { store, filePath } = await loadWithStoredSettings({
      transcriptionProvider: hiddenProvider,
      transcriptionModel: "tiny.en",
      offlineMode: "always-offline",
      appProfiles: [{ id: "notes", name: "Notes", appBundleIds: ["com.notes"], transcriptionProvider: hiddenProvider }],
    });
    const migrated = {
      transcriptionProvider: DEFAULT_SETTINGS.transcriptionProvider,
      transcriptionModel: defaultModelFor("transcription", DEFAULT_SETTINGS.transcriptionProvider),
      offlineMode: "auto",
      appProfiles: [{ id: "notes", transcriptionProvider: DEFAULT_SETTINGS.transcriptionProvider }],
    };

    expect(store.get()).toMatchObject(migrated);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject(migrated);

    const afterFirstLoad = await readFile(filePath, "utf8");
    const { SettingsStore } = await import("@main/store/settings");
    const reloaded = new SettingsStore(filePath);
    await reloaded.init();

    expect(reloaded.get()).toMatchObject(migrated);
    expect(await readFile(filePath, "utf8")).toBe(afterFirstLoad);
  });
});
