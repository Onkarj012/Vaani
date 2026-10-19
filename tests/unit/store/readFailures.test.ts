import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { DictationEntry, DictationTrace } from "@shared/types";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => `/tmp/vaani-test/${name}`,
  },
}));

type Prepare = (path: string) => Promise<unknown>;

const CORRUPT_JSON = "{\"entries\": [not valid json";
const UNEXPECTED_OBJECT = "{\"unexpected\": true}";

const badArrayFiles: Array<[string, Prepare]> = [
  ["corrupt JSON", (path) => writeFile(path, CORRUPT_JSON, "utf8")],
  ["a non-array document", (path) => writeFile(path, UNEXPECTED_OBJECT, "utf8")],
  ["an unreadable path", (path) => mkdir(path)],
];

const badSettingsFiles: Array<[string, Prepare]> = [
  ["corrupt JSON", (path) => writeFile(path, CORRUPT_JSON, "utf8")],
  ["a non-object document", (path) => writeFile(path, "[1, 2]", "utf8")],
  ["an unreadable path", (path) => mkdir(path)],
];

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "vaani-store-read-test-"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

function entry(id: string): DictationEntry {
  return {
    id,
    timestamp: "2026-06-16T00:00:00.000Z",
    rawText: id,
    formattedText: id,
    cleanedText: id,
    durationSeconds: 1,
    appBundleId: null,
    appName: null,
    injectionStatus: "saved",
    injectionMethod: null,
    language: "en",
  };
}

function trace(id: string): DictationTrace {
  return {
    id,
    sessionId: `session-${id}`,
    startedAt: "2026-06-29T00:00:00.000Z",
    targetAppBundleId: "com.apple.TextEdit",
    targetAppName: "TextEdit",
    outcome: "started",
  };
}

describe("HistoryStore read failures", () => {
  it("starts empty when the file is missing and creates it on the first append", async () => {
    const { HistoryStore } = await import("@main/store/history");
    const path = join(tempDir, "history.json");
    const store = new HistoryStore(path);

    expect(await store.getAll()).toEqual([]);
    await store.append(entry("one"));
    expect((await store.getAll()).map((item) => item.id)).toEqual(["one"]);
  });

  it.each(badArrayFiles)("keeps the file and blocks writes on %s", async (_label, prepare) => {
    const { HistoryStore } = await import("@main/store/history");
    const path = join(tempDir, "history.json");
    await prepare(path);
    const before = await snapshot(path);
    const store = new HistoryStore(path);

    await expect(store.getAll()).rejects.toThrow("Could not read");
    await expect(store.append(entry("blocked"))).rejects.toThrow("Could not read");
    await expect(store.delete("one")).rejects.toThrow("Could not read");
    await expect(store.clear()).rejects.toThrow("Could not read");
    expect(await snapshot(path)).toEqual(before);
  });

  it("never puts file contents in the error or the log", async () => {
    const { HistoryStore } = await import("@main/store/history");
    const path = join(tempDir, "history.json");
    // V8 quotes the start of a document that opens with a bad token.
    await writeFile(path, "gsk_canary my secret transcript", "utf8");

    const failure = await new HistoryStore(path).getAll().catch((err: unknown) => err);
    expect(String(failure)).toContain("invalid JSON");
    expect(String(failure)).not.toMatch(/secret transcript|gsk_canary/);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/secret transcript|gsk_canary/);
  });

  it("logs the read failure", async () => {
    const { HistoryStore } = await import("@main/store/history");
    const path = join(tempDir, "history.json");
    await writeFile(path, CORRUPT_JSON, "utf8");

    await expect(new HistoryStore(path).getAll()).rejects.toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`Could not read ${path}`));
  });
});

describe("DictationTraceStore read failures", () => {
  it("starts empty when the file is missing and creates it on the first upsert", async () => {
    const { DictationTraceStore } = await import("@main/store/dictationTrace");
    const path = join(tempDir, "dictation-traces.json");
    const store = new DictationTraceStore(path);

    expect(await store.getAll()).toEqual([]);
    await store.upsert(trace("one"));
    expect((await store.getAll()).map((item) => item.id)).toEqual(["one"]);
  });

  it.each(badArrayFiles)("keeps the file and blocks writes on %s", async (_label, prepare) => {
    const { DictationTraceStore } = await import("@main/store/dictationTrace");
    const path = join(tempDir, "dictation-traces.json");
    await prepare(path);
    const before = await snapshot(path);
    const store = new DictationTraceStore(path);

    await expect(store.getAll()).rejects.toThrow("Could not read");
    await expect(store.upsert(trace("blocked"))).rejects.toThrow("Could not read");
    await expect(store.updateById("one", (current) => current)).rejects.toThrow("Could not read");
    expect(await snapshot(path)).toEqual(before);
  });
});

describe("SettingsStore read failures", () => {
  it("loads defaults and creates the file on the first write when the file is missing", async () => {
    const { SettingsStore } = await import("@main/store/settings");
    const path = join(tempDir, "settings.json");
    const store = new SettingsStore(path);

    await store.init();
    expect(store.get()).toMatchObject({ saveRecordings: DEFAULT_SETTINGS.saveRecordings });
    store.update({ saveRecordings: true });
    await store.flush();
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ saveRecordings: true });
  });

  it.each(badSettingsFiles)("starts on defaults, keeps the file, and blocks writes on %s", async (_label, prepare) => {
    const { SettingsStore } = await import("@main/store/settings");
    const path = join(tempDir, "settings.json");
    await prepare(path);
    const before = await snapshot(path);
    const store = new SettingsStore(path);

    await expect(store.init()).resolves.toBeUndefined();
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(() => store.update({ saveRecordings: true })).toThrow("Could not read");
    await expect(store.flush()).resolves.toBeUndefined();
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(await snapshot(path)).toEqual(before);
  });
});

// Returns file text, or the directory marker for an unreadable path, so a test can compare before and after.
async function snapshot(path: string): Promise<string> {
  const info = await stat(path);
  if (info.isDirectory()) return "<directory>";
  return readFile(path, "utf8");
}
