import { access, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { RECOVERY_ENCRYPTION_VERSION, createRecoveryEntry, type RecoveryEntry } from "@shared/recovery";
import {
  RECOVERY_AUDIO_MAX_BYTES,
  RECOVERY_AUDIO_MAX_SESSIONS,
  EncryptedRecoveryAudioStore,
  isManagedRecoveryAudioPath,
  playWavFile,
  shouldRetainVoicedAudio,
  type PlaybackProcess,
} from "@main/audio/recoveryAudio";
import {
  MemoryRecoveryKeychainBackend,
  RECOVERY_KEYCHAIN_ACCOUNT,
  RECOVERY_KEYCHAIN_SERVICE,
  RecoveryKeyStore,
} from "@main/keychain";

let root: string | null = null;
let roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((directory) => rm(directory, { recursive: true, force: true })));
  root = null;
  roots = [];
});

function clip(durationSeconds = 0.75) {
  const sampleCount = Math.round(durationSeconds * 16_000);
  return {
    pcmData: Array.from({ length: sampleCount }, (_, index) => index % 2 === 0 ? 0.2 : -0.2),
    sampleRate: 16_000,
    durationSeconds,
    rmsFrames: Array.from({ length: Math.ceil(durationSeconds * 50) }, () => 0.2),
  };
}

function silentClip(durationSeconds = 1) {
  const sampleCount = Math.round(durationSeconds * 16_000);
  return {
    pcmData: Array.from({ length: sampleCount }, () => 0),
    sampleRate: 16_000,
    durationSeconds,
    rmsFrames: Array.from({ length: Math.ceil(durationSeconds * 50) }, () => 0),
  };
}

class FakeJournal {
  entries: RecoveryEntry[] = [];
  modes: RecoveryEntry["recoveryMode"][] = [];

  async getAll(): Promise<RecoveryEntry[]> {
    return structuredClone(this.entries);
  }

  async getBySessionId(sessionId: string): Promise<RecoveryEntry | undefined> {
    const entry = this.entries.find((candidate) => candidate.sessionId === sessionId);
    return entry ? structuredClone(entry) : undefined;
  }

  async updateAudio(entryId: string, sessionId: string, audio: RecoveryEntry["audio"]): Promise<RecoveryEntry> {
    const entry = this.entries.find((candidate) => candidate.id === entryId && candidate.sessionId === sessionId);
    if (!entry) throw new Error("entry not found");
    entry.audio = audio;
    return structuredClone(entry);
  }

  async updateRecoveryMode(entryId: string, sessionId: string, recoveryMode: RecoveryEntry["recoveryMode"], error?: RecoveryEntry["lastError"]): Promise<RecoveryEntry> {
    const entry = this.entries.find((candidate) => candidate.id === entryId && candidate.sessionId === sessionId);
    if (!entry) throw new Error("entry not found");
    entry.recoveryMode = recoveryMode;
    if (error) entry.lastError = error;
    this.modes.push(recoveryMode);
    return structuredClone(entry);
  }

  async discard(entryId: string, sessionId: string): Promise<RecoveryEntry | undefined> {
    const entry = this.entries.find((candidate) => candidate.id === entryId && candidate.sessionId === sessionId);
    if (!entry) return undefined;
    entry.state = "discarded";
    entry.terminal = "discarded";
    entry.audio = null;
    return structuredClone(entry);
  }
}

class FakePlaybackProcess extends EventEmitter implements PlaybackProcess {

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    this.emit("exit", code, signal);
  }

  fail(error: Error): void {
    this.emit("error", error);
  }
}

function addEntry(journal: FakeJournal, id: string, overrides: Partial<RecoveryEntry> = {}): RecoveryEntry {
  const entry = { ...createRecoveryEntry({ id, sessionId: id, buildIdentifier: "test" }), ...overrides };
  journal.entries.push(entry);
  return entry;
}

async function setup() {
  root = await mkdtemp(join(tmpdir(), "vaani-recovery-audio-test-"));
  roots.push(root);
  const journal = new FakeJournal();
  const keychain = new MemoryRecoveryKeychainBackend();
  const store = new EncryptedRecoveryAudioStore(journal, new RecoveryKeyStore(keychain), join(root, "audio"));
  return { journal, keychain, store };
}

describe("EncryptedRecoveryAudioStore", () => {
  it("accepts only canonical managed paths with the expected recovery filename", async () => {
    await setup();
    const directory = join(root ?? "", "audio");
    const valid = join(directory, "session.v1.enc");
    expect(isManagedRecoveryAudioPath(directory, `${directory}/../audio/session.v1.enc`, "session")).toBe(false);
    expect(isManagedRecoveryAudioPath(directory, join(root ?? "", "outside.v1.enc"), "session")).toBe(false);
    expect(isManagedRecoveryAudioPath(directory, join(directory, "malformed.enc"), "session")).toBe(false);
    expect(isManagedRecoveryAudioPath(directory, valid, "session")).toBe(true);
  });
  it("retains voiced partials at 500 ms and rejects silence or shorter fragments", () => {
    expect(shouldRetainVoicedAudio(clip(0.5), 0.005)).toBe(true);
    expect(shouldRetainVoicedAudio(clip(0.49), 0.005)).toBe(false);
    expect(shouldRetainVoicedAudio(silentClip(), 0.005)).toBe(false);
  });

  it("writes only authenticated ciphertext and links one encrypted file to the journal", async () => {
    const { journal, store } = await setup();
    const entry = addEntry(journal, "cipher-session");
    const result = await store.spool(entry, clip(), 0.005);
    expect(result.mode).toBe("full");
    if (result.mode !== "full") return;
    expect(result.audio.encryptionVersion).toBe(RECOVERY_ENCRYPTION_VERSION);
    expect(result.audio.sizeBytes).toBeGreaterThan(0);
    expect(result.audio.sampleRate).toBe(16_000);
    expect(result.audio.durationSeconds).toBe(0.75);
    expect(result.audio.checksum).toMatch(/^[a-f0-9]{64}$/);
    const bytes = await readFile(result.audio.path);
    expect(bytes.includes(Buffer.from("0.2"))).toBe(false);
    expect(bytes.includes(Buffer.from("RIFF"))).toBe(false);
    expect((await readdir(join(root ?? "", "audio"))).filter((name) => name.startsWith(".tmp-") || name.endsWith(".wav"))).toEqual([]);
    expect((await journal.getBySessionId(entry.sessionId))?.audio?.path).toBe(result.audio.path);
  });

  it("keeps text-only recovery visible on key loss and corruption without regenerating", async () => {
    const { journal, keychain, store } = await setup();
    const first = addEntry(journal, "key-session");
    const retained = await store.spool(first, clip(), 0.005);
    expect(retained.mode).toBe("full");
    await keychain.set(RECOVERY_KEYCHAIN_SERVICE, RECOVERY_KEYCHAIN_ACCOUNT, "not-a-256-bit-key");
    const second = addEntry(journal, "key-loss-session");
    const result = await store.spool(second, clip(), 0.005);
    expect(result).toMatchObject({ mode: "text-only", reason: "key-corrupt" });
    expect((await journal.getBySessionId(second.sessionId))?.recoveryMode).toBe("text-only");
    expect((await journal.getBySessionId(first.sessionId))?.audio).not.toBeNull();

    const lossSession = addEntry(journal, "key-missing-session");
    const missingKeyStore = new EncryptedRecoveryAudioStore(journal, new RecoveryKeyStore(new MemoryRecoveryKeychainBackend()), join(root ?? "", "audio"));
    expect(await missingKeyStore.spool(lossSession, clip(), 0.005)).toMatchObject({ mode: "text-only", reason: "key-unavailable" });
  });

  it("discovers encrypted audio after restart and always removes playback plaintext", async () => {
    const { journal, keychain, store } = await setup();
    const entry = addEntry(journal, "restart-session");
    await store.spool(entry, clip(), 0.005);
    const restarted = new EncryptedRecoveryAudioStore(journal, new RecoveryKeyStore(keychain), join(root ?? "", "audio"));
    let temporaryPath = "";
    await restarted.withDecryptedAudio(entry.sessionId, async (path) => {
      temporaryPath = path;
      expect((await readFile(path)).subarray(0, 4).toString()).toBe("RIFF");
    });
    await expect(access(temporaryPath)).rejects.toThrow();
    await expect(restarted.withDecryptedAudio(entry.sessionId, () => { throw new Error("playback failed"); })).rejects.toThrow("playback failed");
    await expect(access(temporaryPath)).rejects.toThrow();
  });

  it("rejects a managed filename that is replaced with a symlink", async () => {
    const { journal, store } = await setup();
    const entry = addEntry(journal, "symlink-session");
    const retained = await store.spool(entry, clip(), 0.005);
    if (retained.mode !== "full") throw new Error("expected encrypted audio");

    const outsidePath = join(root ?? "", "outside.enc");
    await writeFile(outsidePath, await readFile(retained.audio.path));
    await rm(retained.audio.path);
    await symlink(outsidePath, retained.audio.path);

    await expect(store.withDecryptedAudio(entry.sessionId, () => undefined)).rejects.toThrow();
  });






  it("expires audio first, preserves text metadata, and supports idempotent success cleanup", async () => {
    const { journal, store } = await setup();
    const entry = addEntry(journal, "expiry-session", {
      text: { rawTranscript: "bounded text", cleanedText: null, formattedText: null },
    });
    await store.spool(entry, clip(), 0.005);
    entry.retention = { expiresAt: "2026-09-02T00:00:00.000Z", audioExpiresAt: "2026-08-31T00:00:00.000Z", expiredAt: null };
    await store.cleanupExpired(new Date("2026-08-31T00:00:01.000Z"));
    const current = await journal.getBySessionId(entry.sessionId);
    expect(current?.audio).toBeNull();
    expect(current?.text.rawTranscript).toBe("bounded text");
    expect(current?.terminal).toBeNull();

    const live = addEntry(journal, "success-session");
    await store.spool(live, clip(), 0.005);
    await store.deleteForSession(live.sessionId);
    await store.deleteForSession(live.sessionId);
    expect((await journal.getBySessionId(live.sessionId))?.audio).toBeNull();

    const discarded = addEntry(journal, "discard-session");
    await store.spool(discarded, clip(), 0.005);
    await store.discardSession(discarded.id, discarded.sessionId);
    await store.discardSession(discarded.id, discarded.sessionId);
    expect((await journal.getBySessionId(discarded.sessionId))?.terminal).toBe("discarded");
  });

  it("keeps ciphertext when a crash happened after rename but before journal linking", async () => {
    const { journal, keychain, store } = await setup();
    const entry = addEntry(journal, "link-pending", {
      retention: { expiresAt: "2026-09-02T00:00:00.000Z", audioExpiresAt: "2026-09-02T00:00:00.000Z", expiredAt: null },
    });
    const retained = await store.spool(entry, clip(), 0.005);
    if (retained.mode !== "full") throw new Error("expected encrypted audio");
    entry.audio = null;
    const restarted = new EncryptedRecoveryAudioStore(journal, new RecoveryKeyStore(keychain), join(root ?? "", "audio"));
    await restarted.reconcileOrphans(new Date("2026-09-01T00:00:00.000Z"));
    await expect(access(retained.audio.path)).resolves.toBeUndefined();
    expect((await journal.getBySessionId(entry.sessionId))?.audio).toMatchObject({
      path: retained.audio.path,
      sizeBytes: retained.audio.sizeBytes,
      sampleRate: 16_000,
      durationSeconds: 0.75,
      checksum: retained.audio.checksum,
    });
  });

  it("deletes invalid and unmatched ciphertext during reconciliation", async () => {
    const { journal, keychain, store } = await setup();
    const entry = addEntry(journal, "valid-session", {
      retention: { expiresAt: "2026-09-02T00:00:00.000Z", audioExpiresAt: "2026-09-02T00:00:00.000Z", expiredAt: null },
    });
    const retained = await store.spool(entry, clip(), 0.005);
    if (retained.mode !== "full") throw new Error("expected encrypted audio");
    const audioDirectory = join(root ?? "", "audio");
    await writeFile(join(audioDirectory, "unmatched.v1.enc"), Buffer.from("not ciphertext"));
    await writeFile(retained.audio.path, Buffer.from("corrupt ciphertext"));

    const restarted = new EncryptedRecoveryAudioStore(journal, new RecoveryKeyStore(keychain), audioDirectory);
    await restarted.reconcileOrphans(new Date("2026-09-01T00:00:00.000Z"));
    await expect(access(retained.audio.path)).rejects.toThrow();
    await expect(access(join(audioDirectory, "unmatched.v1.enc"))).rejects.toThrow();
    expect((await journal.getBySessionId(entry.sessionId))?.audio).toBeNull();

    const stale = addEntry(journal, "stale-session");
    const staleResult = await store.spool(stale, clip(), 0.005);
    if (staleResult.mode !== "full") throw new Error("expected encrypted stale audio");
    stale.retention = { expiresAt: "2026-09-02T00:00:00.000Z", audioExpiresAt: "2026-08-31T00:00:00.000Z", expiredAt: null };
    await restarted.reconcileOrphans(new Date("2026-09-01T00:00:00.000Z"));
    await expect(access(staleResult.audio.path)).rejects.toThrow();
    expect((await journal.getBySessionId(stale.sessionId))?.audio).toBeNull();
  });

  it("waits for the playback process before releasing the decrypted file", async () => {
    const playbackHolder: { value: FakePlaybackProcess | null } = { value: null };
    const playbackPromise = playWavFile("temporary.wav", (_command, _args, _options) => {
      const process = new FakePlaybackProcess();
      playbackHolder.value = process;
      return process;
    });
    await Promise.resolve();
    expect(playbackHolder.value).not.toBeNull();
    let settled = false;
    void playbackPromise.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    const playback = playbackHolder.value;
    if (!playback) throw new Error("Playback process was not started.");
    playback.exit(0, null);
    await expect(playbackPromise).resolves.toBeUndefined();
  });

  it("rejects playback process errors and nonzero exits", async () => {
    const failedProcess = new FakePlaybackProcess();
    const failed = playWavFile("temporary.wav", () => failedProcess);
    failedProcess.fail(new Error("afplay unavailable"));
    await expect(failed).rejects.toThrow("afplay unavailable");

    const exitedProcess = new FakePlaybackProcess();
    const exited = playWavFile("temporary.wav", () => exitedProcess);
    exitedProcess.exit(1, null);
    await expect(exited).rejects.toThrow("code 1");
  });

  it("keeps the journal audio reference when ciphertext deletion fails", async () => {
    const { journal, store } = await setup();
    const entry = addEntry(journal, "delete-failure");
    await store.spool(entry, clip(), 0.005);
    const current = journal.entries.find((candidate) => candidate.sessionId === entry.sessionId);
    if (!current?.audio) throw new Error("expected encrypted audio");
    current.audio.path = join(root ?? "", "audio");
    await expect(store.deleteAudio(entry.sessionId)).rejects.toThrow();
    expect((await journal.getBySessionId(entry.sessionId))?.audio).not.toBeNull();
  });

  it("counts terminal lingering audio and retries cleanup on startup", async () => {
    const { journal, store } = await setup();
    const entry = addEntry(journal, "terminal-audio");
    await store.spool(entry, clip(), 0.005);
    const current = journal.entries.find((candidate) => candidate.sessionId === entry.sessionId);
    const audioPath = current?.audio?.path;
    if (!current?.audio || !audioPath) throw new Error("expected encrypted audio");
    current.terminal = "delivered";
    current.state = "delivered";
    current.audio.path = join(root ?? "", "audio");
    await expect(store.cleanupExpired()).resolves.toMatchObject({ deletedSessionIds: [] });
    expect(await store.getStorageUsage()).toEqual({ sessions: 0, bytes: 0 });

    current.audio.path = audioPath;
    await expect(store.cleanupExpired()).resolves.toMatchObject({ deletedSessionIds: [entry.sessionId] });
    expect(await store.getStorageUsage()).toEqual({ bytes: 0, sessions: 0 });
    expect((await journal.getBySessionId(entry.sessionId))?.audio).toBeNull();
  });

  it("enforces the 50-session and 1 GB caps without deleting unresolved nonexpired work", async () => {
    const { journal, store } = await setup();
    for (let index = 0; index < RECOVERY_AUDIO_MAX_SESSIONS; index += 1) addEntry(journal, `full-${index}`);
    const capped = addEntry(journal, "cap-session");
    const result = await store.spool(capped, clip(), 0.005);
    expect(result).toMatchObject({ mode: "text-only", reason: "cap-reached" });
    expect(journal.entries.filter((entry) => !entry.terminal)).toHaveLength(RECOVERY_AUDIO_MAX_SESSIONS + 1);

    const { journal: byteJournal, store: byteStore } = await setup();
    addEntry(byteJournal, "byte-full", { audio: { kind: "encrypted-session-file", path: "missing.enc", sizeBytes: RECOVERY_AUDIO_MAX_BYTES } });
    const byteCapped = addEntry(byteJournal, "byte-cap-session");
    expect(await byteStore.spool(byteCapped, clip(), 0.005)).toMatchObject({ mode: "text-only", reason: "cap-reached" });
    expect((await byteJournal.getBySessionId("byte-full"))?.audio?.path).toBe("missing.enc");
  });
});
