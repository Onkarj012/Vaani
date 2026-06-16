import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { DictationEntry } from "@shared/types";
import { HistoryStore } from "@main/store/history";

let tempDir: string | null = null;

function entry(id: string, cleanedText = id): DictationEntry {
  return {
    id,
    timestamp: `2026-06-16T00:00:0${id.length}.000Z`,
    rawText: cleanedText,
    formattedText: cleanedText,
    cleanedText,
    durationSeconds: 1,
    appBundleId: null,
    appName: null,
    injectionStatus: "saved",
    injectionMethod: null,
    language: "en",
  };
}

async function createStore(): Promise<HistoryStore> {
  tempDir = await mkdtemp(join(tmpdir(), "vaani-history-test-"));
  return new HistoryStore(join(tempDir, "history.json"));
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("HistoryStore", () => {
  it("does not lose overlapping append operations", async () => {
    const store = await createStore();

    await Promise.all([
      store.append(entry("one")),
      store.append(entry("two")),
    ]);

    expect((await store.getAll()).map((item) => item.id).sort()).toEqual(["one", "two"]);
  });

  it("serializes append and update operations", async () => {
    const store = await createStore();
    await store.append(entry("one", "before"));

    await Promise.all([
      store.append(entry("two")),
      store.updateById("one", (current) => ({ ...current, cleanedText: "after" })),
    ]);

    const history = await store.getAll();
    expect(history.find((item) => item.id === "one")?.cleanedText).toBe("after");
    expect(history.find((item) => item.id === "two")).toBeDefined();
  });
});
