import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  RECOVERY_FIELD_MAX_LENGTH,
  RECOVERY_SCHEMA_VERSION,
  applyRecoveryTransition,
  createRecoveryEntry,
  isLegalRecoveryTransition,
  type RecoveryEntry,
  type RecoveryTransitionInput,
} from "@shared/recovery";
import { isRecoveryEnabled } from "@main/recoveryReadiness";
import { RecoveryJournalStore } from "@main/store/recoveryJournal";
import { consumeRestoredRecoveryNotice } from "@main/recoveryStartup";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

async function createStore(): Promise<{ store: RecoveryJournalStore; filePath: string }> {
  tempDir = await mkdtemp(join(tmpdir(), "vaani-recovery-test-"));
  const filePath = join(tempDir, "recovery-journal.json");
  return { store: new RecoveryJournalStore(filePath), filePath };
}

function transition(entry: RecoveryEntry, to: RecoveryEntry["state"], overrides: Partial<RecoveryTransitionInput> = {}): RecoveryTransitionInput {
  return {
    entryId: entry.id,
    sessionId: entry.sessionId,
    transitionId: `${entry.id}-${entry.attempt + 1}-${to}`,
    to,
    attempt: entry.attempt + 1,
    occurredAt: "2026-09-01T00:00:01.000Z",
    buildIdentifier: "1.2.0+test",
    ...overrides,
  };
}

describe("RecoveryJournalStore", () => {
  it("enforces the transition table, monotonic attempts, idempotence, and stale-session guards", async () => {
    expect(isLegalRecoveryTransition("capturing", "captured")).toBe(true);
    expect(isLegalRecoveryTransition("capturing", "delivered")).toBe(false);

    const { store, filePath } = await createStore();
    const created = await store.create(createRecoveryEntry({ id: "entry-1", sessionId: "session-1", buildIdentifier: "build" }));
    const captured = await store.transition(transition(created, "captured"));
    const duplicate = await store.transition(transition(created, "captured"));
    expect(duplicate).toEqual(captured);

    const beforeInvalid = await readFile(filePath, "utf8");
    await expect(store.transition(transition(captured, "delivered"))).rejects.toThrow("Invalid recovery transition");
    expect(await readFile(filePath, "utf8")).toBe(beforeInvalid);
    await expect(store.transition(transition(captured, "transcribing", { sessionId: "new-session" }))).rejects.toThrow("Stale recovery session");
    await expect(store.transition(transition(captured, "transcribing", { attempt: captured.attempt + 2 }))).rejects.toThrow("monotonically");
  });

  it("keeps unresolved entries discoverable after a fresh store loads the journal", async () => {
    const { store, filePath } = await createStore();
    const created = await store.create(createRecoveryEntry({ id: "entry-2", sessionId: "session-2", buildIdentifier: "build" }));
    await store.transition(transition(created, "captured"));
    const current = await store.getById(created.id);
    if (!current) throw new Error("expected recovery entry");
    await store.transition(transition(current, "recoverable", { error: { class: "transcription_error", detail: "provider failed" } }));

    const restarted = new RecoveryJournalStore(filePath);
    const unresolved = await restarted.getUnresolved();
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.state).toBe("recoverable");
  });

  it("bounds serialized fields and redacts credential-shaped error details", async () => {
    const { store, filePath } = await createStore();
    const huge = "x".repeat(2_000);
    const created = await store.create(createRecoveryEntry({
      id: "entry-3",
      sessionId: "session-3",
      buildIdentifier: huge,
      target: { appBundleId: huge, appName: huge, windowTitle: huge },
    }));
    await store.transition(transition(created, "captured", {
      text: { rawTranscript: huge, cleanedText: huge, formattedText: huge },
      error: { class: "transcription_error", detail: `gsk_secret ${huge}` },
      providerAttempt: {
        attempt: 1,
        provider: huge,
        startedAt: "2026-09-01T00:00:00.000Z",
        completedAt: "2026-09-01T00:00:01.000Z",
        deadlineAt: "2026-09-01T00:00:02.000Z",
        outcome: "failed",
        error: { class: "transcription_error", detail: huge },
      },
    }));

    const raw = await readFile(filePath, "utf8");
    const persisted: unknown = JSON.parse(raw);
    const entry = (persisted as { entries: RecoveryEntry[] }).entries[0];
    if (!entry) throw new Error("Expected a persisted recovery entry.");
    expect(entry.buildIdentifier.length).toBeLessThanOrEqual(RECOVERY_FIELD_MAX_LENGTH);
    expect(entry.target.appName?.length).toBeLessThanOrEqual(RECOVERY_FIELD_MAX_LENGTH);
    expect(entry.text.rawTranscript?.length).toBeLessThanOrEqual(RECOVERY_FIELD_MAX_LENGTH);
    expect(entry.lastError.detail?.length).toBeLessThanOrEqual(RECOVERY_FIELD_MAX_LENGTH);
    expect(entry.providerAttempts[0]?.provider.length).toBeLessThanOrEqual(RECOVERY_FIELD_MAX_LENGTH);
    expect(raw).not.toContain("gsk_secret");
    expect(raw).not.toContain(huge);
  });

  it("migrates legacy entries and records expiry metadata during startup repair", async () => {
    const { store, filePath } = await createStore();
    await writeFile(filePath, JSON.stringify([{
      id: "legacy-1",
      sessionId: "legacy-session",
      status: "failed",
      timestamp: "2026-08-20T00:00:00.000Z",
      rawText: "legacy text",
      appName: "TextEdit",
    }]), "utf8");

    await store.init(new Date("2026-09-01T00:00:00.000Z"));
    const entry = await store.getById("legacy-1");
    expect(entry?.schemaVersion).toBe(RECOVERY_SCHEMA_VERSION);
    expect(entry?.state).toBe("expired");
    expect(entry?.terminal).toBe("expired");
    expect(entry?.retention.expiredAt).toBe("2026-09-01T00:00:00.000Z");
    expect(entry?.text.rawTranscript).toBe("legacy text");

    const repaired: unknown = JSON.parse(await readFile(filePath, "utf8"));
    expect(repaired).toMatchObject({ schemaVersion: RECOVERY_SCHEMA_VERSION, entries: [{ schemaVersion: RECOVERY_SCHEMA_VERSION }] });
  });

  it("leaves readiness disabled by default", () => {
    expect(isRecoveryEnabled()).toBe(false);
  });

  it("deduplicates one startup notice for one restored batch", () => {
    const state: { deliveredBatch: string | null } = { deliveredBatch: null };
    expect(consumeRestoredRecoveryNotice(["b", "a", "a"], state)).toEqual({ entryIds: ["b", "a"], count: 2 });
    expect(consumeRestoredRecoveryNotice(["a", "b"], state)).toBeNull();
    expect(consumeRestoredRecoveryNotice(["a", "c"], state)).toEqual({ entryIds: ["a", "c"], count: 2 });
  });

  it("does not treat temporary files as journal records", async () => {
    const { store, filePath } = await createStore();
    const created = await store.create(createRecoveryEntry({ id: "entry-4", sessionId: "session-4", buildIdentifier: "build" }));
    await writeFile(join(tempDir ?? "", ".tmp-crash-window"), "partial json", "utf8");
    const restarted = new RecoveryJournalStore(filePath);
    expect((await restarted.getDiscoverable()).map((entry) => entry.id)).toEqual([created.id]);
  });

  it("persists insertion preparation and records one idempotent terminal outcome", async () => {
    const { store, filePath } = await createStore();
    const created = await store.create(createRecoveryEntry({ id: "insert-1", sessionId: "insert-1", buildIdentifier: "build" }));
    const captured = await store.transition(transition(created, "captured"));
    const transcriptReady = await store.transition(transition(captured, "transcribing"));
    const ready = await store.transition(transition(transcriptReady, "transcript_ready", {
      text: { rawTranscript: "hello" },
    }));
    const prepared = await store.prepareInsertion(ready.id, ready.sessionId, {
      targetFingerprint: { appBundleId: "com.apple.TextEdit", appName: "TextEdit", windowTitle: null },
      appIdentity: { appBundleId: "com.apple.TextEdit", appName: "TextEdit", windowTitle: null },
      baselineReadable: false,
      baselineHash: null,
      textHash: "a".repeat(64),
      intendedStrategy: "clipboard",
      deadlineAt: "2026-09-01T00:00:02.000Z",
    });
    expect(prepared.insertion).toMatchObject({ outcome: "pending", baselineReadable: false, intendedStrategy: "clipboard" });

    const copied = await store.recordInsertionOutcome(ready.id, ready.sessionId, "copied", {
      method: "clipboard",
      reason: "insertion_failed",
      detail: "x".repeat(2_000),
    });
    const duplicate = await store.recordInsertionOutcome(ready.id, ready.sessionId, "copied", { method: "clipboard" });
    expect(duplicate).toEqual(copied);
    expect(copied.insertion).toMatchObject({ outcome: "copied", status: "failed", method: "clipboard" });
    expect(copied.terminal).toBe("copied");
    expect(copied.attempt).toBe(ready.attempt + 1);
    expect(copied.insertion?.detail?.length).toBeLessThanOrEqual(500);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({ entries: [{ insertion: { outcome: "copied" } }] });
    await expect(store.prepareInsertion(ready.id, ready.sessionId, {
      targetFingerprint: { appBundleId: null, appName: null, windowTitle: null },
      appIdentity: { appBundleId: null, appName: null, windowTitle: null },
      baselineReadable: true,
      baselineHash: null,
      textHash: "b".repeat(64),
      intendedStrategy: "clipboard",
      deadlineAt: "2026-09-01T00:00:03.000Z",
    })).resolves.toEqual(copied);
    await expect(store.recordInsertionOutcome(ready.id, ready.sessionId, "delivered", { method: "clipboard" })).rejects.toThrow("terminal outcome");
  });

  it("fails closed on malformed journal JSON and preserves its bytes across later mutations", async () => {
    const { store, filePath } = await createStore();
    const corrupt = "{\"entries\": [not valid json";
    await writeFile(filePath, corrupt, "utf8");

    await expect(store.init()).rejects.toThrow("malformed");
    expect(await readFile(filePath, "utf8")).toBe(corrupt);
    await expect(store.create(createRecoveryEntry({ id: "blocked", sessionId: "blocked", buildIdentifier: "build" }))).rejects.toThrow("malformed");
    expect(await readFile(filePath, "utf8")).toBe(corrupt);
  });

  it("fails closed on a valid JSON document with an invalid journal shape", async () => {
    const { store, filePath } = await createStore();
    const corrupt = "{\"unexpected\": true}";
    await writeFile(filePath, corrupt, "utf8");

    await expect(store.getAll()).rejects.toThrow("invalid JSON shape");
    expect(await readFile(filePath, "utf8")).toBe(corrupt);
  });
});

describe("recovery transition pure function", () => {
  it("rejects invalid transitions without returning a mutated entry", () => {
    const entry = createRecoveryEntry({ id: "pure-1", sessionId: "pure-session", buildIdentifier: "build" });
    expect(() => applyRecoveryTransition(entry, transition(entry, "inserting"))).toThrow("Invalid recovery transition");
    expect(entry.state).toBe("capturing");
    expect(entry.attempt).toBe(0);
  });
});
