import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("sanitizes malformed nested trace payloads on load", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-trace-test-"));
    const filePath = join(tempDir, "traces.json");
    await writeFile(filePath, JSON.stringify([{
      id: "malformed",
      sessionId: "session-malformed",
      startedAt: "2026-06-29T00:00:00.000Z",
      targetAppBundleId: "com.apple.TextEdit",
      targetAppName: "TextEdit",
      rawAudio: { durationSeconds: "bad" },
      trimmedAudio: {
        durationSeconds: 1,
        sampleRate: 16_000,
        sampleCount: 16_000,
        rmsAverage: 0.1,
        rmsPeak: 0.2,
        peakAmplitude: 0.3,
        clippingRatio: 0,
        silenceRatio: 0.1,
      },
      quality: { provider: 42 },
      qualityDecision: { action: "save", reason: "quiet-short-fragment" },
      providerAttempts: [
        {
          provider: "groq",
          success: true,
          latencyMs: "slow",
          quality: {
            provider: "groq",
            attemptCount: 1,
            supportsConfidence: true,
            noSpeechProbability: 0.8,
            transcriptLength: 9,
          },
        },
        { provider: 42, success: true },
      ],
      injectionAttempts: [
        { targetAppBundleId: 42, targetAppName: "TextEdit", method: "bad", success: true },
      ],
      outcome: "saved",
    }]), "utf8");

    const { DictationTraceStore } = await import("@main/store/dictationTrace");
    const store = new DictationTraceStore(filePath);
    const loaded = await store.getById("malformed");

    expect(loaded?.rawAudio).toBeUndefined();
    expect(loaded?.trimmedAudio?.sampleRate).toBe(16_000);
    expect(loaded?.quality).toBeUndefined();
    expect(loaded?.qualityDecision).toEqual({ action: "save", reason: "quiet-short-fragment" });
    expect(loaded?.providerAttempts).toHaveLength(1);
    expect(loaded?.providerAttempts?.[0]?.latencyMs).toBeUndefined();
    expect(loaded?.providerAttempts?.[0]?.quality?.noSpeechProbability).toBe(0.8);
    expect(loaded?.injectionAttempts?.[0]).toMatchObject({ targetAppBundleId: null, targetAppName: "TextEdit", success: true });
    expect(loaded?.injectionAttempts?.[0]?.method).toBeUndefined();
  });
});
