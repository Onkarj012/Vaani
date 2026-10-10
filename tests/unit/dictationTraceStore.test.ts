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
  it.each(["verified", "unconfirmed", "refused", "copy-only", "failed"] as const)("reloads the %s insertion outcome", async (outcome) => {
    const store = await createStore();
    await store.upsert({ ...trace(outcome), outcome, stages: { outcome } });
    if (!tempDir) throw new Error("Trace test directory was not initialized.");
    const { DictationTraceStore } = await import("@main/store/dictationTrace");
    const reloaded = new DictationTraceStore(join(tempDir, "traces.json"));

    expect(await reloaded.getById(outcome)).toMatchObject({ outcome, stages: { outcome } });
  });

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

  it("reloads formatter timeout and stale-session trace details", async () => {
    const store = await createStore();
    await store.upsert({ ...trace("format"), outcome: "injected", stages: { formatterUsed: "none", formatterStatus: "failed", formatterStatusReason: "Formatting timed out.", formatterReason: "timeout" } });
    await store.upsert({ ...trace("stale"), outcome: "failed", rejectionReason: "stale-session", stages: { staleStage: "transcribing", outcome: "failed" } });
    if (!tempDir) throw new Error("Trace test directory was not initialized.");
    const { DictationTraceStore } = await import("@main/store/dictationTrace");
    const reloaded = new DictationTraceStore(join(tempDir, "traces.json"));

    expect((await reloaded.getById("format"))?.stages).toMatchObject({ formatterUsed: "none", formatterStatus: "failed", formatterStatusReason: "Formatting timed out.", formatterReason: "timeout" });
    expect(await reloaded.getById("stale")).toMatchObject({ rejectionReason: "stale-session", stages: { staleStage: "transcribing" } });
  });

  it("round-trips the optional stage timestamps through storage and reload", async () => {
    const store = await createStore();
    const timestamps = {
      stopRequestedAt: "2026-09-26T00:00:01.000Z",
      lastFrameAfterStopMs: 340,
      trailingRms: 0.02,
      clipReadyAt: "2026-09-26T00:00:01.300Z",
      sttDoneAt: "2026-09-26T00:00:02.000Z",
      formatDoneAt: "2026-09-26T00:00:02.200Z",
      dispatchAt: "2026-09-26T00:00:02.400Z",
      verifyDoneAt: "2026-09-26T00:00:02.600Z",
    };
    await store.upsert({ ...trace("timed"), ...timestamps });
    const { DictationTraceStore } = await import("@main/store/dictationTrace");
    const reloaded = new DictationTraceStore(join(tempDir ?? "", "traces.json"));
    expect(await reloaded.getById("timed")).toMatchObject(timestamps);
  });

  it("caps stored traces at the most recent 200 sessions", async () => {
    const store = await createStore();

    for (let index = 0; index < 205; index += 1) {
      await store.upsert(trace(`trace-${index}`));
    }

    const all = await store.getAll();
    expect(all).toHaveLength(200);
    expect(all[0]?.id).toBe("trace-204");
    expect(all[199]?.id).toBe("trace-5");
    expect(await store.getById("trace-4")).toBeUndefined();
  });

  it("sanitizes malformed nested trace payloads on load", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-trace-test-"));
    const filePath = join(tempDir, "traces.json");
    await writeFile(filePath, JSON.stringify([{
      id: "malformed",
      sessionId: "session-malformed",
      startedAt: "2026-06-29T00:00:00.000Z",
      buildIdentifier: "1.2.3+abc1234",
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
      stages: {
        outcome: "nonsense",
      },
      outcome: "nonsense",
      rejectionReason: "not_a_reason",
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
    expect(loaded?.outcome).toBe("nonsense");
    expect(loaded?.rejectionReason).toBeUndefined();
    expect(loaded?.stages?.outcome).toBe("nonsense");
    expect(loaded?.buildIdentifier).toBe("1.2.3+abc1234");
    await store.updateById("malformed", (current) => ({ ...current, userMessage: "Future schema retained" }));
    const reloaded = new DictationTraceStore(filePath);
    expect((await reloaded.getById("malformed"))?.outcome).toBe("nonsense");
  });

  it("sanitizes capture, gate, and segment fields on load", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-trace-test-"));
    const filePath = join(tempDir, "traces.json");
    await writeFile(filePath, JSON.stringify([{
      id: "capture",
      sessionId: "session-capture",
      startedAt: "2026-06-29T00:00:00.000Z",
      targetAppBundleId: null,
      targetAppName: null,
      captureSettings: { echoCancellation: true, autoGainControl: "yes", noiseSuppression: false, extra: 1 },
      captureLevels: { preGainPeak: 0.02, preGainRms: "loud", gain: 5 },
      speechGate: { pass: true, reason: "speech", noiseFloor: 0.01, enterThreshold: 0.03, longestRunMs: 200, totalSpeechMs: 300 },
      quality: { provider: "groq", attemptCount: 1, supportsConfidence: true, transcriptLength: 9, segmentNoSpeechProbabilities: [0.1, "x", 0.4] },
      outcome: "verified",
    }, {
      id: "gate-decision",
      sessionId: "session-gate-decision",
      startedAt: "2026-06-29T00:00:00.000Z",
      targetAppBundleId: null,
      targetAppName: null,
      speechGate: { pass: true, decision: "uncertain", reason: "no-speech-contrast", noiseFloor: 0.004, enterThreshold: 0.01, longestRunMs: 0, totalSpeechMs: 0 },
      outcome: "verified",
    }, {
      id: "gate-bad-decision",
      sessionId: "session-gate-bad-decision",
      startedAt: "2026-06-29T00:00:00.000Z",
      targetAppBundleId: null,
      targetAppName: null,
      speechGate: { pass: true, decision: "maybe", reason: "speech", noiseFloor: 0.01, enterThreshold: 0.03, longestRunMs: 200, totalSpeechMs: 300 },
      outcome: "verified",
    }]), "utf8");

    const { DictationTraceStore } = await import("@main/store/dictationTrace");
    const store = new DictationTraceStore(filePath);
    const loaded = await store.getById("capture");

    expect(loaded?.captureSettings).toEqual({ echoCancellation: true, noiseSuppression: false });
    expect(loaded?.captureLevels).toBeUndefined();
    expect(loaded?.speechGate).toEqual({ pass: true, reason: "speech", noiseFloor: 0.01, enterThreshold: 0.03, longestRunMs: 200, totalSpeechMs: 300 });
    expect((await store.getById("gate-decision"))?.speechGate?.decision).toBe("uncertain");
    expect((await store.getById("gate-bad-decision"))?.speechGate?.decision).toBeUndefined();
    expect(loaded?.quality?.segmentNoSpeechProbabilities).toEqual([0.1, 0.4]);
  });

  it("caps the per-segment no-speech list at 50 entries on write", async () => {
    const store = await createStore();
    await store.upsert({
      ...trace("long-clip"),
      quality: {
        provider: "groq",
        attemptCount: 1,
        supportsConfidence: true,
        transcriptLength: 9,
        segmentNoSpeechProbabilities: Array.from({ length: 60 }, () => 0.1),
      },
    });
    expect((await store.getById("long-clip"))?.quality?.segmentNoSpeechProbabilities).toHaveLength(50);
  });

  it("retains baseline-unreadable insertion verification reasons on load", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-trace-test-"));
    const filePath = join(tempDir, "traces.json");
    const verification = { readable: false, passed: false, repaired: false, reason: "baseline-unreadable" };
    await writeFile(filePath, JSON.stringify([{
      ...trace("baseline-unreadable"),
      injectionAttempts: [{
        targetAppBundleId: "com.apple.TextEdit",
        targetAppName: "TextEdit",
        method: "clipboard",
        success: true,
        verification,
      }],
      stages: { insertionVerification: verification },
    }]), "utf8");

    const { DictationTraceStore } = await import("@main/store/dictationTrace");
    const store = new DictationTraceStore(filePath);
    const loaded = await store.getById("baseline-unreadable");

    expect(loaded?.injectionAttempts?.[0]?.verification?.reason).toBe("baseline-unreadable");
    expect(loaded?.stages?.insertionVerification?.reason).toBe("baseline-unreadable");
  });
});
