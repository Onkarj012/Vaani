import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import { buildResetSettingsPatch } from "@renderer/lib/settingsReset";

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

describe("SettingsStore", () => {
  it("starts with both kinds of audio retention disabled", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-consent-test-"));
    const { SettingsStore } = await import("@main/store/settings");
    const store = new SettingsStore(join(tempDir, "settings.json"));
    await store.init();
    expect(store.get()).toMatchObject({ saveRecordings: false, retainFailedAudio: false });
  });

  it("requires fresh consent for legacy failed-audio defaults while preserving explicit WAV recording", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-consent-test-"));
    const filePath = join(tempDir, "settings.json");
    await writeFile(filePath, JSON.stringify({ retainFailedAudio: true, saveRecordings: true }));
    const { SettingsStore } = await import("@main/store/settings");
    const store = new SettingsStore(filePath);
    await store.init();
    expect(store.get()).toMatchObject({ saveRecordings: true, retainFailedAudio: false });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({ saveRecordings: true, retainFailedAudio: false });
  });

  it("persists explicit failed-audio consent across restart and unrelated changes", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-consent-test-"));
    const filePath = join(tempDir, "settings.json");
    const { SettingsStore } = await import("@main/store/settings");
    const store = new SettingsStore(filePath);
    await store.init();
    store.update({ retainFailedAudio: true });
    await store.flush();
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({ retainFailedAudio: true, failedAudioRetentionOptIn: true });

    const reloaded = new SettingsStore(filePath);
    await reloaded.init();
    expect(reloaded.get().retainFailedAudio).toBe(true);
    expect(reloaded.get()).not.toHaveProperty("failedAudioRetentionOptIn");
    reloaded.update({ saveRecordings: true });
    await reloaded.flush();
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({ saveRecordings: true, retainFailedAudio: true, failedAudioRetentionOptIn: true });
  });

  it.each(["toggle", "reset"] as const)("revokes failed-audio consent through %s and does not restore it on restart", async (action) => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-consent-test-"));
    const filePath = join(tempDir, "settings.json");
    await writeFile(filePath, JSON.stringify({ retainFailedAudio: true, failedAudioRetentionOptIn: true }));
    const { SettingsStore } = await import("@main/store/settings");
    const store = new SettingsStore(filePath);
    await store.init();
    store.update(action === "reset" ? buildResetSettingsPatch(store.get()) : { retainFailedAudio: false });
    expect(store.get().retainFailedAudio).toBe(false);
    await store.flush();
    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    expect(persisted).toMatchObject({ retainFailedAudio: false });
    expect(persisted).not.toHaveProperty("failedAudioRetentionOptIn");
    const reloaded = new SettingsStore(filePath);
    await reloaded.init();
    expect(reloaded.get().retainFailedAudio).toBe(false);
  });

  it("surfaces failed consent writes and allows a later write to recover", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-consent-test-"));
    const blockedDir = join(tempDir, "blocked");
    await writeFile(blockedDir, "not a directory");
    const { SettingsStore } = await import("@main/store/settings");
    const store = new SettingsStore(join(blockedDir, "settings.json"));
    await store.init();
    store.update({ retainFailedAudio: false });
    await expect(store.flush()).rejects.toThrow();
    expect(store.get().retainFailedAudio).toBe(false);
    await rm(blockedDir);
    store.update({ retainFailedAudio: false });
    await expect(store.flush()).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(join(blockedDir, "settings.json"), "utf8"))).toMatchObject({ retainFailedAudio: false });
  });

  it("prunes legacy aggressive filler words when not customized", async () => {
    const { pruneLegacyFillerWords } = await import("../../src/main/store/settings");

    expect(pruneLegacyFillerWords(
      ["um", "uh", "like", "basically", "you know", "sort of", "kind of", "actually", "literally"],
      false,
    )).toEqual(["um", "uh"]);
  });

  it("leaves legacy filler words untouched when customized", async () => {
    const { pruneLegacyFillerWords } = await import("../../src/main/store/settings");
    const fillerWords = ["um", "uh", "like"];

    expect(pruneLegacyFillerWords(fillerWords, true)).toBeNull();
  });

  it("returns null when there are no legacy aggressive filler words to prune", async () => {
    const { pruneLegacyFillerWords } = await import("../../src/main/store/settings");

    expect(pruneLegacyFillerWords(["um", "uh"], false)).toBeNull();
  });

  it("migrates the legacy default filler list to the minimal default", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-settings-test-"));
    const filePath = join(tempDir, "settings.json");
    await writeFile(filePath, JSON.stringify({
      ...DEFAULT_SETTINGS,
      fillerWords: ["um", "uh", "like", "basically", "you know", "sort of", "kind of", "actually", "literally"],
    }), "utf8");

    const { SettingsStore } = await import("../../src/main/store/settings");
    const store = new SettingsStore(filePath);
    await store.init();

    expect(store.get().fillerWords).toEqual(["um", "uh"]);
    expect(store.get().extraFillerWords).toEqual([]);
  });

  it("migrates stored native capture back to the renderer stabilization default", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-settings-test-"));
    const filePath = join(tempDir, "settings.json");
    await writeFile(filePath, JSON.stringify({
      ...DEFAULT_SETTINGS,
      captureBackend: "native",
    }), "utf8");

    const { SettingsStore } = await import("../../src/main/store/settings");
    const store = new SettingsStore(filePath);
    await store.init();

    expect(store.get().captureBackend).toBe("renderer");
  });

  it("preserves native capture after an explicit opt-in update", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-settings-test-"));
    const filePath = join(tempDir, "settings.json");

    const { SettingsStore } = await import("../../src/main/store/settings");
    const store = new SettingsStore(filePath);
    await store.init();
    store.update({ captureBackend: "native" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const freshStore = new SettingsStore(filePath);
    await freshStore.init();

    expect(freshStore.get().captureBackend).toBe("native");
  });

  it("preserves native capture opt-in across unrelated updates", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-settings-test-"));
    const filePath = join(tempDir, "settings.json");

    const { SettingsStore } = await import("../../src/main/store/settings");
    const store = new SettingsStore(filePath);
    await store.init();
    store.update({ captureBackend: "native" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const reloaded = new SettingsStore(filePath);
    await reloaded.init();
    reloaded.update({ saveRecordings: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const freshStore = new SettingsStore(filePath);
    await freshStore.init();

    expect(freshStore.get().captureBackend).toBe("native");
  });

  it("migrates implicit warm mic settings back to the idle-off default", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-settings-test-"));
    const filePath = join(tempDir, "settings.json");
    await writeFile(filePath, JSON.stringify({
      ...DEFAULT_SETTINGS,
      preWarmMic: true,
    }), "utf8");

    const { SettingsStore } = await import("../../src/main/store/settings");
    const store = new SettingsStore(filePath);
    await store.init();

    expect(store.get().preWarmMic).toBe(false);
  });

  it("preserves warm mic after an explicit low latency opt-in update", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-settings-test-"));
    const filePath = join(tempDir, "settings.json");

    const { SettingsStore } = await import("../../src/main/store/settings");
    const store = new SettingsStore(filePath);
    await store.init();
    store.update({ preWarmMic: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const freshStore = new SettingsStore(filePath);
    await freshStore.init();

    expect(freshStore.get().preWarmMic).toBe(true);
  });

  it("preserves warm mic opt-in across unrelated updates", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-settings-test-"));
    const filePath = join(tempDir, "settings.json");

    const { SettingsStore } = await import("../../src/main/store/settings");
    const store = new SettingsStore(filePath);
    await store.init();
    store.update({ preWarmMic: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const reloaded = new SettingsStore(filePath);
    await reloaded.init();
    reloaded.update({ saveRecordings: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const freshStore = new SettingsStore(filePath);
    await freshStore.init();

    expect(freshStore.get().preWarmMic).toBe(true);
  });

  it("marks filler words customized when filler words are patched", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-settings-test-"));
    const filePath = join(tempDir, "settings.json");

    const { SettingsStore } = await import("../../src/main/store/settings");
    const store = new SettingsStore(filePath);
    await store.init();

    expect(store.update({ fillerWords: ["um"] }).fillerWordsCustomized).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it("persists provider validation metadata across reloads", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-settings-test-"));
    const filePath = join(tempDir, "settings.json");
    const validation = {
      valid: true,
      message: "Provider API key is valid.",
      testedAt: "2026-09-01T00:00:00.000Z",
    };

    const { SettingsStore } = await import("../../src/main/store/settings");
    const store = new SettingsStore(filePath);
    await store.init();
    store.update({ providerApiKeys: [{ providerId: "openai", key: "", hasKey: true, lastValidation: validation }] });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const reloaded = new SettingsStore(filePath);
    await reloaded.init();
    expect(reloaded.get().providerApiKeys).toEqual([{
      providerId: "openai",
      key: "",
      hasKey: true,
      lastValidation: validation,
    }]);
  });
});
