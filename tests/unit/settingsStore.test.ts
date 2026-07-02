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
  it("migrates the legacy default filler list to the minimal default", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-settings-test-"));
    const filePath = join(tempDir, "settings.json");
    await writeFile(filePath, JSON.stringify({
      ...DEFAULT_SETTINGS,
      fillerWords: ["um", "uh", "like", "basically", "you know", "sort of", "kind of", "actually", "literally"],
    }), "utf8");

    const { SettingsStore } = await import("@main/store/settings");
    const store = new SettingsStore(filePath);
    await store.init();

    expect(store.get().fillerWords).toEqual(["um", "uh"]);
    expect(store.get().extraFillerWords).toEqual([]);
  });
});
