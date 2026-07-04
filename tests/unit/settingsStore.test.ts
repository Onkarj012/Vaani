import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";

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

  it("marks filler words customized when filler words are patched", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-settings-test-"));
    const filePath = join(tempDir, "settings.json");

    const { SettingsStore } = await import("../../src/main/store/settings");
    const store = new SettingsStore(filePath);
    await store.init();

    expect(store.update({ fillerWords: ["um"] }).fillerWordsCustomized).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
