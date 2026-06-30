import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DictationTrace } from "@shared/types";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => `/tmp/vaani-test/${name}`,
  },
}));

let tempDir: string | null = null;

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

async function createStore() {
  tempDir = await mkdtemp(join(tmpdir(), "vaani-trace-test-"));
  const { DictationTraceStore } = await import("@main/store/dictationTrace");
  return new DictationTraceStore(join(tempDir, "traces.json"));
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("DictationTraceStore", () => {
  it("upserts traces and retrieves them by id or session id", async () => {
    const store = await createStore();
    await store.upsert(trace("one"));

    expect((await store.getById("one"))?.sessionId).toBe("session-one");
    expect((await store.getBySessionId("session-one"))?.id).toBe("one");
  });

  it("serializes overlapping updates", async () => {
    const store = await createStore();
    await store.upsert(trace("one"));

    await Promise.all([
      store.updateById("one", (current) => ({ ...current, outcome: "injected" })),
      store.updateById("one", (current) => ({ ...current, sttLatencyMs: 125 })),
    ]);

    const updated = await store.getById("one");
    expect(updated?.outcome).toBe("injected");
    expect(updated?.sttLatencyMs).toBe(125);
  });
});
