import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, copyFile, mkdir, open, readdir, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { app } from "electron";
import type { AudioClip } from "@shared/types";
import { APP_DATA_DIR } from "@shared/defaults";
import {
  RECOVERY_ENCRYPTION_VERSION,
  type RecoveryAudioReference,
  type RecoveryEntry,
} from "@shared/recovery";
import { createWavBuffer } from "@main/providers/shared/audioUtils";
import { clipPeak, evaluateSpeechGate } from "./speechGate";
import { RecoveryKeyAccessError, RecoveryKeyCorruptError, RecoveryKeyMissingError, RecoveryKeyStore } from "@main/keychain";

export const RECOVERY_AUDIO_MAX_BYTES = 1_000_000_000;
export const RECOVERY_AUDIO_MAX_SESSIONS = 50;
export const RECOVERY_MIN_VOICED_DURATION_MS = 500;
const RECOVERY_AUDIO_MAGIC = Buffer.from("VAANI-R02", "ascii");
const RECOVERY_AUDIO_IV_BYTES = 12;
const RECOVERY_AUDIO_TAG_BYTES = 16;
const RECOVERY_AUDIO_OVERHEAD_BYTES = RECOVERY_AUDIO_MAGIC.length + 1 + RECOVERY_AUDIO_IV_BYTES + RECOVERY_AUDIO_TAG_BYTES;
let lastAudioFileTime = 0;

export interface RecoveryAudioJournal {
  getAll(): Promise<RecoveryEntry[]>;
  getBySessionId(sessionId: string): Promise<RecoveryEntry | undefined>;
  updateAudio(entryId: string, sessionId: string, audio: RecoveryAudioReference | null): Promise<RecoveryEntry>;
  updateRecoveryMode?(entryId: string, sessionId: string, recoveryMode: RecoveryEntry["recoveryMode"], error?: RecoveryEntry["lastError"]): Promise<RecoveryEntry>;
  expire?(entryId: string, sessionId: string, occurredAt?: string): Promise<RecoveryEntry | undefined>;
  discard?(entryId: string, sessionId: string): Promise<RecoveryEntry | undefined>;
}

export type RecoveryAudioSpoolResult =
  | { mode: "full"; audio: RecoveryAudioReference }
  | { mode: "text-only"; reason: "key-unavailable" | "key-corrupt" | "cap-reached" | "storage-failure"; detail: string };

export interface RecoveryAudioCleanupResult {
  deletedSessionIds: string[];
  preservedTextEntries: number;
}

export interface PlaybackProcess {
  once(event: "error", listener: (error: Error) => void): PlaybackProcess;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): PlaybackProcess;
}

export type PlaybackSpawner = (
  command: string,
  args: readonly string[],
  options: { stdio: "ignore" },
) => PlaybackProcess;

export class EncryptedRecoveryAudioStore {
  private readonly directory: string;
  private readonly sessionMutations = new Map<string, Promise<void>>();
  private readonly inFlight = new Map<string, number>();
  private pendingCapacity: Promise<void> = Promise.resolve();

  constructor(
    private readonly journal: RecoveryAudioJournal,
    private readonly keyStore = new RecoveryKeyStore(),
    directory = process.env.VAANI_RECOVERY_AUDIO_DIR ?? join(app.getPath("home"), APP_DATA_DIR, "recovery-audio"),
  ) {
    this.directory = directory;
  }

  async spool(
    entry: RecoveryEntry,
    clip: AudioClip,
    silenceThreshold: number,
    now = new Date(),
  ): Promise<RecoveryAudioSpoolResult> {
    return this.withSessionMutation(entry.sessionId, async () => {
      try {
        return await this.spoolLocked(entry, clip, silenceThreshold, now);
      } finally {
        this.inFlight.delete(entry.sessionId);
      }
    });
  }

  private async spoolLocked(entry: RecoveryEntry, clip: AudioClip, silenceThreshold: number, now: Date): Promise<RecoveryAudioSpoolResult> {
    const current = await this.journal.getBySessionId(entry.sessionId);
    if (!current || current.id !== entry.id || current.terminal) {
      throw new Error("Recovery session is unavailable for audio retention.");
    }
    if (!shouldRetainVoicedAudio(clip, silenceThreshold)) {
      return { mode: "text-only", reason: "storage-failure", detail: "Voiced audio was shorter than 500 ms or contained only silence." };
    }

    const hasCapacity = await this.withCapacityMutation(async () => {
      await this.cleanupExpired(now);
      const unresolved = (await this.journal.getAll()).filter((candidate) => {
        const expiry = Date.parse(candidate.retention.audioExpiresAt ?? candidate.retention.expiresAt);
        return !candidate.terminal && candidate.id !== entry.id && candidate.audio !== null && Number.isFinite(expiry) && expiry > now.getTime();
      });
      const totalBytes = unresolved.reduce((sum, candidate) => sum + (candidate.audio?.sizeBytes ?? 0), 0);
      const inFlight = [...this.inFlight].filter(([sessionId]) => sessionId !== entry.sessionId && !unresolved.some((candidate) => candidate.sessionId === sessionId));
      const inFlightBytes = inFlight.reduce((sum, [, bytes]) => sum + bytes, 0);
      const estimatedBytes = estimateEncryptedWavSize(clip);
      if (unresolved.length + inFlight.length >= RECOVERY_AUDIO_MAX_SESSIONS || totalBytes + inFlightBytes + estimatedBytes > RECOVERY_AUDIO_MAX_BYTES) return false;
      this.inFlight.set(entry.sessionId, estimatedBytes);
      return true;
    });
    if (!hasCapacity) {
      return this.markTextOnly(entry, { mode: "text-only", reason: "cap-reached", detail: "Recovery audio storage is full; text recovery is retained." });
    }

    let journalUpdateFailed = false;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700).catch(() => undefined);
      const hasCiphertext = await this.hasCiphertext();
      const key = await this.keyStore.getOrCreate(hasCiphertext);
      const plaintext = createWavBuffer(clip);
      const iv = randomBytes(RECOVERY_AUDIO_IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(buildAssociatedData(entry.sessionId));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const fileBytes = Buffer.concat([
        RECOVERY_AUDIO_MAGIC,
        Buffer.from([RECOVERY_ENCRYPTION_VERSION]),
        iv,
        authTag,
        ciphertext,
      ]);
      lastAudioFileTime = Math.max(Date.now(), lastAudioFileTime + 1);
      const path = join(this.directory, fileNameForSession(entry.sessionId, `${lastAudioFileTime}-${randomBytes(8).toString("hex")}`));
      const temporaryPath = join(this.directory, `.tmp-${randomBytes(8).toString("hex")}.enc`);
      await writeFile(temporaryPath, fileBytes, { mode: 0o600 });
      try {
        await rename(temporaryPath, path);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
      await chmod(path, 0o600).catch(() => undefined);
      const audio: RecoveryAudioReference = {
        kind: "encrypted-session-file",
        path,
        encryptionVersion: RECOVERY_ENCRYPTION_VERSION,
        sizeBytes: fileBytes.length,
        sampleRate: clip.sampleRate,
        durationSeconds: clip.durationSeconds,
        checksum: createHash("sha256").update(fileBytes).digest("hex"),
      };
      try {
        const linked = await this.journal.updateAudio(entry.id, entry.sessionId, audio);
        if (linked.audio?.path !== path) throw new Error("Recovery audio journal link was not committed.");
      } catch (error) {
        journalUpdateFailed = true;
        throw error;
      }
      if (current.audio?.path && current.audio.path !== path && isManagedRecoveryAudioPath(this.directory, current.audio.path, entry.sessionId)) {
        await unlink(current.audio.path).catch(() => undefined);
      }
      return { mode: "full", audio };
    } catch (error) {
      if (journalUpdateFailed) throw error;
      const detail = error instanceof Error ? error.message : "Recovery audio could not be encrypted.";
      if (error instanceof RecoveryKeyMissingError || detail.includes("missing")) {
        return this.markTextOnly(entry, { mode: "text-only", reason: "key-unavailable", detail: "Recovery encryption key is unavailable; text recovery is retained." });
      }
      if (error instanceof RecoveryKeyCorruptError) {
        return this.markTextOnly(entry, { mode: "text-only", reason: "key-corrupt", detail: "Recovery encryption key is corrupt; text recovery is retained." });
      }
      if (error instanceof RecoveryKeyAccessError) {
        return this.markTextOnly(entry, { mode: "text-only", reason: "key-unavailable", detail: "Recovery encryption key is unavailable; text recovery is retained." });
      }
      return this.markTextOnly(entry, { mode: "text-only", reason: "storage-failure", detail: `Recovery audio was not retained: ${detail}` });
    }
  }

  private async withSessionMutation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.sessionMutations.get(sessionId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    this.sessionMutations.set(sessionId, pending);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.sessionMutations.get(sessionId) === pending) this.sessionMutations.delete(sessionId);
    }
  }

  private async withCapacityMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.pendingCapacity;
    let release: () => void = () => undefined;
    this.pendingCapacity = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async reconcileOrphans(now = new Date()): Promise<void> {
    await rm(join(this.directory, "playback"), { recursive: true, force: true });
    const entries = await this.journal.getAll();
    const byPath = new Map(entries.flatMap((entry) => entry.audio?.path && isManagedRecoveryAudioPath(this.directory, entry.audio.path, entry.sessionId)
      ? [[resolve(entry.audio.path), entry] as const]
      : []));
    const candidates: Array<{ path: string; session: RecoveryEntry; linked: RecoveryEntry | undefined; modifiedAt: number }> = [];
    for (const name of await this.encryptedFileNames()) {
      const path = join(this.directory, name);
      const linked = byPath.get(resolve(path));
      const pending = entries.find((entry) => !entry.terminal && isBeforeExpiry(entry, now) && isManagedRecoveryAudioPath(this.directory, path, entry.sessionId));
      const session = linked ?? pending;
      if (!session) {
        if (isManagedRecoveryAudioCandidatePath(this.directory, path)) {
          await unlink(path).catch(() => undefined);
        }
        continue;
      }
      if (!isBeforeExpiry(session, now) || session.terminal) {
        if (isManagedRecoveryAudioCandidatePath(this.directory, path)) {
          await unlink(path).catch(() => undefined);
        }
        if (linked) await this.journal.updateAudio(linked.id, linked.sessionId, null).catch(() => undefined);
        continue;
      }
      const modifiedAt = await stat(path).then((value) => value.mtimeMs).catch(() => -1);
      candidates.push({ path, session, linked, modifiedAt });
    }
    if (candidates.length === 0) return;
    let key: Buffer;
    try {
      key = await this.keyStore.getOrCreate(true);
    } catch (error) {
      // A missing/corrupt key does not authenticate a ciphertext as invalid.
      // Keep it recoverable and let the next startup retry with the key fixed.
      if (error instanceof RecoveryKeyMissingError || error instanceof RecoveryKeyCorruptError || error instanceof RecoveryKeyAccessError) return;
      throw error;
    }
    candidates.sort((a, b) => {
      const newer = fileTime(b.path) - fileTime(a.path);
      return newer || b.modifiedAt - a.modifiedAt;
    });
    const selected = new Set<string>();
    for (const { path, session, linked } of candidates) {
      if (selected.has(session.sessionId)) {
        await unlink(path).catch(() => undefined);
        continue;
      }
      let fileBytes: Buffer;
      let metadata: { sampleRate: number; durationSeconds: number };
      try {
        ({ fileBytes } = await readManagedRecoveryAudio(this.directory, path, session.sessionId));
      } catch {
        continue;
      }
      try {
        const plaintext = decryptAudio(fileBytes, key, session.sessionId);
        metadata = describeWav(plaintext);
      } catch {
        if (linked) await this.journal.updateAudio(linked.id, linked.sessionId, null).catch(() => undefined);
        if (isManagedRecoveryAudioPath(this.directory, path, session.sessionId)) await unlink(path).catch(() => undefined);
        continue;
      }
      const audio: RecoveryAudioReference = {
          kind: "encrypted-session-file",
          path,
          encryptionVersion: RECOVERY_ENCRYPTION_VERSION,
          sizeBytes: fileBytes.length,
          sampleRate: metadata.sampleRate,
          durationSeconds: metadata.durationSeconds,
          checksum: createHash("sha256").update(fileBytes).digest("hex"),
      };
      if (linked?.audio?.checksum && linked.audio.checksum !== audio.checksum) {
        await this.journal.updateAudio(linked.id, linked.sessionId, null);
        await unlink(path).catch(() => undefined);
        continue;
      }
      if (!linked) {
        const relinked = await this.journal.updateAudio(session.id, session.sessionId, audio);
        if (relinked.audio?.path !== path) throw new Error("Recovery audio relink was not committed.");
        if (session.audio?.path && session.audio.path !== path && isManagedRecoveryAudioPath(this.directory, session.audio.path, session.sessionId)) {
          await unlink(session.audio.path).catch(() => undefined);
        }
      }
      selected.add(session.sessionId);
    }
  }

  async deleteForSession(sessionId: string): Promise<void> {
    const entry = await this.journal.getBySessionId(sessionId);
    if (!entry) return;
    if (entry.audio?.path) {
      const managedPath = await assertManagedRecoveryAudioPath(this.directory, entry.audio.path, sessionId);
      await unlinkCiphertext(managedPath);
    }
    if (entry.audio) await this.journal.updateAudio(entry.id, sessionId, null);
  }

  async deleteAudio(sessionId: string): Promise<void> {
    return this.deleteForSession(sessionId);
  }

  async discardSession(entryId: string, sessionId: string): Promise<void> {
    return this.withSessionMutation(sessionId, async () => {
      const entry = await this.journal.getBySessionId(sessionId);
      if (!entry || entry.id !== entryId) return;
      await this.deleteForSession(sessionId);
      await this.journal.discard?.(entryId, sessionId);
    });
  }

  async discard(entryId: string, sessionId: string): Promise<void> {
    return this.discardSession(entryId, sessionId);
  }

  async cleanupExpired(now = new Date()): Promise<RecoveryAudioCleanupResult> {
    const entries = await this.journal.getAll();
    const deletedSessionIds: string[] = [];
    let preservedTextEntries = 0;
    for (const entry of entries) {
      const expiry = Date.parse(entry.retention.audioExpiresAt ?? entry.retention.expiresAt);
      if (!entry.audio || (!entry.terminal && (!Number.isFinite(expiry) || expiry > now.getTime()))) continue;
      try {
        const managedPath = await assertManagedRecoveryAudioPath(this.directory, entry.audio.path, entry.sessionId);
        await unlinkCiphertext(managedPath);
      } catch {
        continue;
      }
      await this.journal.updateAudio(entry.id, entry.sessionId, null);
      deletedSessionIds.push(entry.sessionId);
      if (entry.text.rawTranscript || entry.text.cleanedText || entry.text.formattedText) preservedTextEntries += 1;
    }
    return { deletedSessionIds, preservedTextEntries };
  }

  async withDecryptedAudio<T>(sessionId: string, operation: (temporaryWavPath: string) => Promise<T> | T): Promise<T> {
    const entry = await this.journal.getBySessionId(sessionId);
    if (!entry?.audio?.path) throw new Error("Recovery audio is unavailable.");
    const key = await this.keyStore.getOrCreate(true);
    const { fileBytes } = await readManagedRecoveryAudio(this.directory, entry.audio.path, sessionId);
    if (entry.audio.checksum && createHash("sha256").update(fileBytes).digest("hex") !== entry.audio.checksum) {
      throw new Error("Recovery audio checksum failed.");
    }
    const plaintext = decryptAudio(fileBytes, key, sessionId);
    const playbackDirectory = join(this.directory, "playback");
    await mkdir(playbackDirectory, { recursive: true, mode: 0o700 });
    if (await realpath(playbackDirectory) !== join(await realpath(this.directory), "playback")) {
      throw new Error("Recovery playback directory is not private.");
    }
    await chmod(playbackDirectory, 0o700);
    const temporaryPath = join(playbackDirectory, `vaani-recovery-playback-${randomBytes(8).toString("hex")}.wav`);
    try {
      await writeFile(temporaryPath, plaintext, { mode: 0o600 });
      return await operation(temporaryPath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  async playDecryptedAudio(sessionId: string): Promise<void> {
    await this.withDecryptedAudio(sessionId, (temporaryPath) => playWavFile(temporaryPath));
  }

  async exportDecryptedWav(sessionId: string, destinationPath: string): Promise<void> {
    await this.withDecryptedAudio(sessionId, (temporaryPath) => copyFile(temporaryPath, destinationPath));
  }

  async discoverUnresolved(): Promise<RecoveryEntry[]> {
    return (await this.journal.getAll()).filter((entry) => !entry.terminal);
  }

  async getStorageUsage(): Promise<{ bytes: number; sessions: number }> {
    const entries = (await this.journal.getAll()).filter((entry) => entry.audio);
    let bytes = 0;
    let sessions = 0;
    for (const entry of entries) {
      const path = entry.audio?.path;
      if (!path) continue;
      let managedPath: string;
      try {
        managedPath = await assertManagedRecoveryAudioPath(this.directory, path, entry.sessionId);
      } catch {
        continue;
      }
      const size = await stat(managedPath).then((value) => value.size).catch(() => entry.audio?.sizeBytes ?? 0);
      bytes += size;
      sessions += 1;
    }
    return { bytes, sessions };
  }

  private async hasCiphertext(): Promise<boolean> {
    return (await this.encryptedFileNames()).length > 0;
  }

  private async markTextOnly(entry: RecoveryEntry, result: Extract<RecoveryAudioSpoolResult, { mode: "text-only" }>): Promise<Extract<RecoveryAudioSpoolResult, { mode: "text-only" }>> {
    await this.journal.updateRecoveryMode?.(entry.id, entry.sessionId, "text-only", {
      class: result.reason === "key-unavailable" || result.reason === "key-corrupt"
        ? result.reason === "key-corrupt" ? "recovery_key_corrupt" : "recovery_key_unavailable"
        : result.reason === "cap-reached" ? "recovery_cap_reached" : "recovery_storage_failure",
      detail: result.detail,
    });
    return result;
  }

  private async encryptedFileNames(): Promise<string[]> {
    const names = await readdir(this.directory).catch(() => [] as string[]);
    return names.filter((name) => name.endsWith(`.v${RECOVERY_ENCRYPTION_VERSION}.enc`) || (name.startsWith(".tmp-") && name.endsWith(".enc")));
  }
}

export function playWavFile(filePath: string, spawnProcess: PlaybackSpawner = spawnWavFile): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const process = spawnProcess("afplay", [filePath], { stdio: "ignore" });
    process.once("error", (error) => finish(error));
    process.once("exit", (code, signal) => {
      if (code === 0) {
        finish();
      } else {
        finish(new Error(signal ? `Recovery audio playback ended with ${signal}.` : `Recovery audio playback exited with code ${code ?? "unknown"}.`));
      }
    });
  });
}

const spawnWavFile: PlaybackSpawner = (command, args, options) => spawn(command, [...args], options);

export function shouldRetainVoicedAudio(clip: AudioClip, silenceThreshold: number): boolean {
  if (clip.pcmData.length === 0 || clip.durationSeconds < RECOVERY_MIN_VOICED_DURATION_MS / 1000) return false;
  return evaluateSpeechGate(clip.rmsFrames, clipPeak(clip.pcmData)).totalSpeechMs >= RECOVERY_MIN_VOICED_DURATION_MS
    && clip.rmsFrames.some((frame) => frame >= silenceThreshold);
}

export function estimateEncryptedWavSize(clip: AudioClip): number {
  return RECOVERY_AUDIO_OVERHEAD_BYTES + 44 + clip.pcmData.length * 2;
}

function buildAssociatedData(sessionId: string): Buffer {
  return Buffer.from(`vaani-recovery-audio:${RECOVERY_ENCRYPTION_VERSION}:${sessionId}`, "utf8");
}

function decryptAudio(fileBytes: Buffer, key: Buffer, sessionId: string): Buffer {
  const minimumLength = RECOVERY_AUDIO_OVERHEAD_BYTES;
  if (fileBytes.length < minimumLength || !fileBytes.subarray(0, RECOVERY_AUDIO_MAGIC.length).equals(RECOVERY_AUDIO_MAGIC)) {
    throw new Error("Recovery audio file is invalid.");
  }
  const versionOffset = RECOVERY_AUDIO_MAGIC.length;
  if (fileBytes[versionOffset] !== RECOVERY_ENCRYPTION_VERSION) throw new Error("Recovery audio version is unsupported.");
  const ivStart = versionOffset + 1;
  const tagStart = ivStart + RECOVERY_AUDIO_IV_BYTES;
  const ciphertextStart = tagStart + RECOVERY_AUDIO_TAG_BYTES;
  const decipher = createDecipheriv("aes-256-gcm", key, fileBytes.subarray(ivStart, tagStart));
  decipher.setAuthTag(fileBytes.subarray(tagStart, ciphertextStart));
  decipher.setAAD(buildAssociatedData(sessionId));
  return Buffer.concat([decipher.update(fileBytes.subarray(ciphertextStart)), decipher.final()]);
}

function describeWav(bytes: Buffer): { sampleRate: number; durationSeconds: number } {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Recovery audio WAV header is invalid.");
  }
  const channels = bytes.readUInt16LE(22);
  const sampleRate = bytes.readUInt32LE(24);
  const bitsPerSample = bytes.readUInt16LE(34);
  const dataOffset = bytes.indexOf(Buffer.from("data"), 36);
  if (channels !== 1 || bitsPerSample !== 16 || sampleRate < 8_000 || sampleRate > 192_000 || dataOffset < 0 || dataOffset + 8 > bytes.length) {
    throw new Error("Recovery audio WAV format is unsupported.");
  }
  const dataLength = bytes.readUInt32LE(dataOffset + 4);
  if (dataLength <= 0 || dataLength % 2 !== 0 || dataOffset + 8 + dataLength > bytes.length) {
    throw new Error("Recovery audio WAV data is invalid.");
  }
  return { sampleRate, durationSeconds: dataLength / 2 / sampleRate };
}

function isBeforeExpiry(entry: RecoveryEntry, now: Date): boolean {
  const expiry = Date.parse(entry.retention.audioExpiresAt ?? entry.retention.expiresAt);
  return Number.isFinite(expiry) && expiry > now.getTime();
}

function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function fileNameForSession(sessionId: string, nonce?: string): string {
  return `${safeSessionId(sessionId)}${nonce ? `.${nonce}` : ""}.v${RECOVERY_ENCRYPTION_VERSION}.enc`;
}

function fileTime(path: string): number {
  const match = /\.([0-9]{13})-[a-f0-9]{16}\.v1\.enc$/.exec(path);
  return match ? Number(match[1]) : 0;
}

export function isManagedRecoveryAudioPath(directory: string, path: string, sessionId: string): boolean {
  if (!path || !sessionId || path !== resolve(path)) return false;
  const name = basename(path);
  if (name !== fileNameForSession(sessionId) && !new RegExp(`^${safeSessionId(sessionId)}\\.(?:[0-9]{13}-)?[a-f0-9]{16}\\.v${RECOVERY_ENCRYPTION_VERSION}\\.enc$`).test(name)) return false;
  const managedPath = resolve(path);
  const relativePath = relative(resolve(directory), managedPath);
  return relativePath === name
    && !isAbsolute(relativePath)
    && !relativePath.startsWith(`..${sep}`);
}

function isManagedRecoveryAudioCandidatePath(directory: string, path: string): boolean {
  if (!path || path !== resolve(path)) return false;
  const relativePath = relative(resolve(directory), resolve(path));
  return /^(?:[a-zA-Z0-9_-]{1,120}(?:\.(?:[0-9]{13}-)?[a-f0-9]{16})?\.v1\.enc|\.tmp-[a-f0-9]{16}\.enc)$/.test(basename(path))
    && relativePath === basename(path)
    && !isAbsolute(relativePath)
    && !relativePath.startsWith(`..${sep}`);
}

async function assertManagedRecoveryAudioPath(directory: string, path: string, sessionId: string): Promise<string> {
  if (!isManagedRecoveryAudioPath(directory, path, sessionId)) {
    throw new Error("Recovery audio path is outside the managed session file.");
  }
  const canonicalDirectory = await realpath(directory).catch((error: unknown) => {
    if (isMissingFileError(error)) return resolve(directory);
    throw error;
  });
  try {
    const canonicalPath = await realpath(path);
    if (!isManagedRecoveryAudioPath(canonicalDirectory, canonicalPath, sessionId)) {
      throw new Error("Recovery audio path resolves outside the managed session file.");
    }
    return canonicalPath;
  } catch (error) {
    if (isMissingFileError(error)) return resolve(path);
    throw error;
  }
}

async function readManagedRecoveryAudio(directory: string, path: string, sessionId: string): Promise<{ managedPath: string; fileBytes: Buffer }> {
  const managedPath = await assertManagedRecoveryAudioPath(directory, path, sessionId);
  const noFollow = constants.O_NOFOLLOW;
  if (typeof noFollow !== "number") throw new Error("Recovery audio cannot be read safely on this platform.");
  const handle = await open(managedPath, constants.O_RDONLY | noFollow);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("Recovery audio is not a regular file.");
    return { managedPath, fileBytes: await handle.readFile() };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function unlinkCiphertext(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
