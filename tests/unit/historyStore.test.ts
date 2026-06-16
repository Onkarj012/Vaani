import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { DictationEntry } from "@shared/types";
import { HistoryStore } from "@main/store/history";

let tempDir: string | null = null;
let historyPath: string | null = null;

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
  historyPath = join(tempDir, "history.json");
  return new HistoryStore(historyPath);
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
    historyPath = null;
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

  it("serves coherent cached reads after writes and returns defensive copies", async () => {
    const store = await createStore();
    await store.append(entry("one"));

    const firstRead = await store.getAll();
    firstRead.length = 0;

    const secondRead = await store.getAll();
    expect(secondRead.map((item) => item.id)).toEqual(["one"]);
  });

  it("returns latest and by-id entries from the hydrated cache", async () => {
    const store = await createStore();
    await store.append(entry("older"));
    await store.append(entry("newer"));

    expect((await store.getLatest())?.id).toBe("newer");
    expect((await store.getById("older"))?.cleanedText).toBe("older");
  });

  it("hydrates a fresh store from an existing history file", async () => {
    const store = await createStore();
    await store.append(entry("persisted"));

    expect(historyPath).toBeTruthy();
    const freshStore = new HistoryStore(historyPath ?? "");

    expect((await freshStore.getAll()).map((item) => item.id)).toEqual(["persisted"]);
  });

  it("normalizes a cold-start history file once before serving cached reads", async () => {
    await createStore();
    expect(historyPath).toBeTruthy();
    await writeFile(historyPath ?? "", JSON.stringify([{ id: "raw", rawText: "hello" }]), "utf8");
    const store = new HistoryStore(historyPath ?? "");

    expect((await store.getById("raw"))?.cleanedText).toBe("hello");
    expect((await store.getLatest())?.id).toBe("raw");
  });
});
