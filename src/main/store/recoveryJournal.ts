import { app } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { APP_DATA_DIR } from "@shared/defaults";
import {
  cloneRecoveryEntry,
  createRecoveryEntry,
  normalizeRecoveryDocument,
  repairRecoveryEntry,
  sanitizeRecoveryEntry,
  applyRecoveryTransition,
  type RecoveryEntry,
  type RecoveryEntrySeed,
  type RecoveryState,
  type RecoveryTransitionInput,
  type RecoveryLifecycleFacts,
  type RecoveryInsertionPreparation,
  type RecoveryInsertionTerminalOutcome,
  RECOVERY_SCHEMA_VERSION,
} from "@shared/recovery";
import { repairJsonFilePermissions, writeJsonFile } from "./base";

interface RecoveryJournalDocument {
  schemaVersion: typeof RECOVERY_SCHEMA_VERSION;
  entries: RecoveryEntry[];
}

const MISSING_FILE = Symbol("missing-recovery-journal");

export class RecoveryJournalStore {
  private readonly filePath: string;
  private pendingMutation: Promise<void> = Promise.resolve();
  private cache: RecoveryJournalDocument | null = null;

  constructor(filePath = join(app.getPath("home"), APP_DATA_DIR, "recovery-journal.json")) {
    this.filePath = filePath;
  }

  async init(now = new Date()): Promise<void> {
    await this.ensureLoaded(now);
  }

  async flush(): Promise<void> {
    await this.pendingMutation;
  }

  async markRouteHandoff(
    entryId: string,
    sessionId: string,
    handoff: NonNullable<RecoveryEntry["routeHandoff"]>,
  ): Promise<RecoveryEntry> {
    let result: RecoveryEntry | undefined;
    await this.enqueueMutation(async () => {
      const document = await this.ensureLoaded();
      const index = document.entries.findIndex((entry) => entry.id === entryId);
      const current = document.entries[index];
      if (!current || current.sessionId !== sessionId) throw new Error("Stale recovery session.");
      const nextEntry = sanitizeRecoveryEntry({ ...current, routeHandoff: handoff, updatedAt: new Date().toISOString() });
      const entries = document.entries.slice();
      entries[index] = nextEntry;
      const next: RecoveryJournalDocument = { schemaVersion: RECOVERY_SCHEMA_VERSION, entries };
      await writeJsonFile(this.filePath, next);
      this.cache = next;
      result = cloneRecoveryEntry(nextEntry);
    });
    if (!result) throw new Error("Recovery route handoff was not recorded.");
    return result;
  }

  async markLifecycle(entryId: string, sessionId: string, lifecycle: RecoveryLifecycleFacts): Promise<RecoveryEntry> {
    let result: RecoveryEntry | undefined;
    await this.enqueueMutation(async () => {
      const document = await this.ensureLoaded();
      const index = document.entries.findIndex((entry) => entry.id === entryId);
      const current = document.entries[index];
      if (!current || current.sessionId !== sessionId) throw new Error("Stale recovery session.");
      const nextEntry = sanitizeRecoveryEntry({ ...current, lifecycle, updatedAt: new Date().toISOString() });
      const entries = document.entries.slice();
      entries[index] = nextEntry;
      const next: RecoveryJournalDocument = { schemaVersion: RECOVERY_SCHEMA_VERSION, entries };
      await writeJsonFile(this.filePath, next);
      this.cache = next;
      result = cloneRecoveryEntry(nextEntry);
    });
    if (!result) throw new Error("Recovery lifecycle fact was not recorded.");
    return result;
  }

  async getAll(): Promise<RecoveryEntry[]> {
    const document = await this.ensureLoaded();
    return document.entries.map(cloneRecoveryEntry);
  }

  async getUnresolved(): Promise<RecoveryEntry[]> {
    const entries = await this.getAll();
    return entries.filter((entry) => !entry.terminal);
  }

  async getDiscoverable(): Promise<RecoveryEntry[]> {
    return this.getAll();
  }

  async listUnresolved(): Promise<RecoveryEntry[]> {
    return this.getUnresolved();
  }

  async getById(id: string): Promise<RecoveryEntry | undefined> {
    const document = await this.ensureLoaded();
    const entry = document.entries.find((candidate) => candidate.id === id);
    return entry ? cloneRecoveryEntry(entry) : undefined;
  }

  async getBySessionId(sessionId: string): Promise<RecoveryEntry | undefined> {
    const document = await this.ensureLoaded();
    const entry = document.entries.find((candidate) => candidate.sessionId === sessionId);
    return entry ? cloneRecoveryEntry(entry) : undefined;
  }

  async updateAudio(entryId: string, sessionId: string, audio: RecoveryEntry["audio"]): Promise<RecoveryEntry> {
    let result: RecoveryEntry | undefined;
    await this.enqueueMutation(async () => {
      const document = await this.ensureLoaded();
      const index = document.entries.findIndex((entry) => entry.id === entryId);
      const current = document.entries[index];
      if (!current || current.sessionId !== sessionId) throw new Error("Stale recovery session.");
      const nextEntry = sanitizeRecoveryEntry({ ...current, audio, recoveryMode: audio ? "full" : current.recoveryMode, updatedAt: new Date().toISOString() });
      const entries = document.entries.slice();
      entries[index] = nextEntry;
      const next: RecoveryJournalDocument = { schemaVersion: RECOVERY_SCHEMA_VERSION, entries };
      await writeJsonFile(this.filePath, next);
      this.cache = next;
      result = cloneRecoveryEntry(nextEntry);
    });
    if (!result) throw new Error("Recovery audio metadata was not updated.");
    return result;
  }

  async updateRecoveryMode(
    entryId: string,
    sessionId: string,
    recoveryMode: RecoveryEntry["recoveryMode"],
    error?: RecoveryEntry["lastError"],
  ): Promise<RecoveryEntry> {
    let result: RecoveryEntry | undefined;
    await this.enqueueMutation(async () => {
      const document = await this.ensureLoaded();
      const index = document.entries.findIndex((entry) => entry.id === entryId);
      const current = document.entries[index];
      if (!current || current.sessionId !== sessionId) throw new Error("Stale recovery session.");
      const nextEntry = sanitizeRecoveryEntry({
        ...current,
        recoveryMode,
        lastError: error ?? current.lastError,
        updatedAt: new Date().toISOString(),
      });
      const entries = document.entries.slice();
      entries[index] = nextEntry;
      const next: RecoveryJournalDocument = { schemaVersion: RECOVERY_SCHEMA_VERSION, entries };
      await writeJsonFile(this.filePath, next);
      this.cache = next;
      result = cloneRecoveryEntry(nextEntry);
    });
    if (!result) throw new Error("Recovery mode was not updated.");
    return result;
  }

  async updateText(
    entryId: string,
    sessionId: string,
    text: Partial<RecoveryEntry["text"]>,
    state?: RecoveryState,
  ): Promise<RecoveryEntry> {
    let result: RecoveryEntry | undefined;
    await this.enqueueMutation(async () => {
      const document = await this.ensureLoaded();
      const index = document.entries.findIndex((entry) => entry.id === entryId);
      const current = document.entries[index];
      if (!current || current.sessionId !== sessionId) throw new Error("Stale recovery session.");
      if (current.terminal) {
        result = cloneRecoveryEntry(current);
        return;
      }
      const nextEntry = sanitizeRecoveryEntry({
        ...current,
        state: state ?? current.state,
        text: { ...current.text, ...text },
        attempt: current.attempt + 1,
        updatedAt: new Date().toISOString(),
        lastTransitionId: `text:${current.id}:${current.attempt + 1}`,
      });
      const entries = document.entries.slice();
      entries[index] = nextEntry;
      const next: RecoveryJournalDocument = { schemaVersion: RECOVERY_SCHEMA_VERSION, entries };
      await writeJsonFile(this.filePath, next);
      this.cache = next;
      result = cloneRecoveryEntry(nextEntry);
    });
    if (!result) throw new Error("Recovery text was not updated.");
    return result;
  }

  async prepareInsertion(
    entryId: string,
    sessionId: string,
    preparation: RecoveryInsertionPreparation,
  ): Promise<RecoveryEntry> {
    let result: RecoveryEntry | undefined;
    await this.enqueueMutation(async () => {
      const document = await this.ensureLoaded();
      const index = document.entries.findIndex((entry) => entry.id === entryId);
      const current = document.entries[index];
      if (!current || current.sessionId !== sessionId) throw new Error("Stale recovery session.");
      if (current.terminal) {
        result = cloneRecoveryEntry(current);
        return;
      }
      if (current.insertion?.outcome === "delivered" || current.insertion?.outcome === "copied") {
        result = cloneRecoveryEntry(current);
        return;
      }
      const insertion: RecoveryEntry["insertion"] = {
        status: "pending",
        outcome: "pending",
        method: null,
        targetFingerprint: preparation.targetFingerprint,
        appIdentity: preparation.appIdentity,
        baselineReadable: preparation.baselineReadable,
        baselineHash: preparation.baselineHash,
        textHash: preparation.textHash,
        intendedStrategy: preparation.intendedStrategy,
        deadlineAt: preparation.deadlineAt,
      };
      const nextEntry = sanitizeRecoveryEntry({ ...current, insertion, deadlineAt: preparation.deadlineAt, updatedAt: new Date().toISOString() });
      const entries = document.entries.slice();
      entries[index] = nextEntry;
      const next: RecoveryJournalDocument = { schemaVersion: RECOVERY_SCHEMA_VERSION, entries };
      await writeJsonFile(this.filePath, next);
      this.cache = next;
      result = cloneRecoveryEntry(nextEntry);
    });
    if (!result) throw new Error("Recovery insertion was not prepared.");
    return result;
  }

  async recordInsertionOutcome(
    entryId: string,
    sessionId: string,
    outcome: RecoveryInsertionTerminalOutcome,
    details: Pick<NonNullable<RecoveryEntry["insertion"]>, "method" | "reason" | "detail"> = {},
  ): Promise<RecoveryEntry> {
    let result: RecoveryEntry | undefined;
    await this.enqueueMutation(async () => {
      const document = await this.ensureLoaded();
      const index = document.entries.findIndex((entry) => entry.id === entryId);
      const current = document.entries[index];
      if (!current || current.sessionId !== sessionId) throw new Error("Stale recovery session.");
      if (current.terminal) {
        if (current.terminal !== outcome) throw new Error("Recovery insertion already has a terminal outcome.");
        result = cloneRecoveryEntry(current);
        return;
      }
      const prior = current.insertion?.outcome;
      if (prior && prior !== "pending") {
        if (prior !== outcome) throw new Error("Recovery insertion already has a terminal outcome.");
        result = cloneRecoveryEntry(current);
        return;
      }
      const insertion: NonNullable<RecoveryEntry["insertion"]> = {
        ...(current.insertion ?? { status: "pending" as const }),
        status: outcome === "delivered" ? "verified" as const : "failed" as const,
        outcome,
        method: details.method ?? current.insertion?.method ?? null,
        ...(details.reason ? { reason: details.reason } : {}),
        ...(details.detail ? { detail: details.detail } : {}),
      };
      const destination = outcome === "delivered" ? "delivered" : outcome === "copied" ? "copied" : "recoverable";
      const nextEntry = applyRecoveryTransition(current, {
        entryId: current.id,
        sessionId,
        transitionId: `insertion-outcome:${current.id}:${current.attempt + 1}`,
        to: destination,
        attempt: current.attempt + 1,
        occurredAt: new Date().toISOString(),
        buildIdentifier: current.buildIdentifier,
        insertion,
        error: outcome === "delivered" ? { class: "none" } : { class: details.reason ?? "insertion_failed", detail: details.detail },
        terminal: outcome === "delivered" || outcome === "copied" ? outcome : null,
      });
      const entries = document.entries.slice();
      entries[index] = nextEntry;
      const next: RecoveryJournalDocument = { schemaVersion: RECOVERY_SCHEMA_VERSION, entries };
      await writeJsonFile(this.filePath, next);
      this.cache = next;
      result = cloneRecoveryEntry(nextEntry);
    });
    if (!result) throw new Error("Recovery insertion outcome was not recorded.");
    return result;
  }

  async discard(entryId: string, sessionId: string): Promise<RecoveryEntry | undefined> {
    let result: RecoveryEntry | undefined;
    await this.enqueueMutation(async () => {
      const document = await this.ensureLoaded();
      const index = document.entries.findIndex((entry) => entry.id === entryId);
      const current = document.entries[index];
      if (!current) return;
      if (current.sessionId !== sessionId) throw new Error("Stale recovery session.");
      if (current.terminal) {
        result = cloneRecoveryEntry(current);
        return;
      }
      const nextEntry = sanitizeRecoveryEntry({
        ...current,
        state: "discarded",
        terminal: "discarded",
        audio: null,
        attempt: current.attempt + 1,
        updatedAt: new Date().toISOString(),
        lastError: { class: "none" },
        lastTransitionId: `discard:${current.id}:${current.attempt + 1}`,
      });
      const entries = document.entries.slice();
      entries[index] = nextEntry;
      const next: RecoveryJournalDocument = { schemaVersion: RECOVERY_SCHEMA_VERSION, entries };
      await writeJsonFile(this.filePath, next);
      this.cache = next;
      result = cloneRecoveryEntry(nextEntry);
    });
    return result;
  }

  async expire(entryId: string, sessionId: string, occurredAt = new Date().toISOString()): Promise<RecoveryEntry | undefined> {
    let result: RecoveryEntry | undefined;
    await this.enqueueMutation(async () => {
      const document = await this.ensureLoaded();
      const index = document.entries.findIndex((entry) => entry.id === entryId);
      const current = document.entries[index];
      if (!current) return;
      if (current.sessionId !== sessionId) throw new Error("Stale recovery session.");
      if (current.terminal) {
        result = cloneRecoveryEntry(current);
        return;
      }
      const nextEntry = sanitizeRecoveryEntry({
        ...current,
        state: "expired",
        terminal: "expired",
        audio: null,
        attempt: current.attempt + 1,
        updatedAt: occurredAt,
        lastError: { class: "expired" },
        retention: { ...current.retention, expiredAt: occurredAt },
        lastTransitionId: `expiry:${current.id}:${current.attempt + 1}`,
      });
      const entries = document.entries.slice();
      entries[index] = nextEntry;
      const next: RecoveryJournalDocument = { schemaVersion: RECOVERY_SCHEMA_VERSION, entries };
      await writeJsonFile(this.filePath, next);
      this.cache = next;
      result = cloneRecoveryEntry(nextEntry);
    });
    return result;
  }

  async create(seed: RecoveryEntrySeed | RecoveryEntry): Promise<RecoveryEntry> {
    let created: RecoveryEntry | undefined;
    await this.enqueueMutation(async () => {
      const document = await this.ensureLoaded();
      const candidate = "schemaVersion" in seed ? sanitizeRecoveryEntry(seed) : createRecoveryEntry(seed);
      const existing = document.entries.find((entry) => entry.id === candidate.id);
      if (existing) {
        if (existing.sessionId !== candidate.sessionId) throw new Error("Recovery entry id belongs to another session.");
        created = cloneRecoveryEntry(existing);
        return;
      }
      const next: RecoveryJournalDocument = { schemaVersion: RECOVERY_SCHEMA_VERSION, entries: [candidate, ...document.entries] };
      await writeJsonFile(this.filePath, next);
      this.cache = next;
      created = cloneRecoveryEntry(candidate);
    });
    if (!created) throw new Error("Recovery entry was not created.");
    return created;
  }

  async upsert(seed: RecoveryEntrySeed | RecoveryEntry): Promise<RecoveryEntry> {
    return this.create(seed);
  }

  async transition(input: RecoveryTransitionInput): Promise<RecoveryEntry> {
    let result: RecoveryEntry | undefined;
    await this.enqueueMutation(async () => {
      const document = await this.ensureLoaded();
      const index = document.entries.findIndex((entry) => entry.id === input.entryId);
      if (index < 0) throw new Error("Recovery entry was not found.");
      const current = document.entries[index];
      if (!current) throw new Error("Recovery entry was not found.");
      const nextEntry = applyRecoveryTransition(current, input);
      if (JSON.stringify(nextEntry) === JSON.stringify(current)) {
        result = cloneRecoveryEntry(current);
        return;
      }
      const entries = document.entries.slice();
      entries[index] = nextEntry;
      const next: RecoveryJournalDocument = { schemaVersion: RECOVERY_SCHEMA_VERSION, entries };
      await writeJsonFile(this.filePath, next);
      this.cache = next;
      result = cloneRecoveryEntry(nextEntry);
    });
    if (!result) throw new Error("Recovery transition was not applied.");
    return result;
  }

  async applyTransition(input: RecoveryTransitionInput): Promise<RecoveryEntry> {
    return this.transition(input);
  }

  async repair(now = new Date()): Promise<RecoveryEntry[]> {
    let repaired: RecoveryEntry[] = [];
    await this.enqueueMutation(async () => {
      const document = await this.ensureLoaded(now);
      const entries = document.entries.map((entry) => repairRecoveryEntry(entry, now));
      if (JSON.stringify(entries) !== JSON.stringify(document.entries)) {
        const next: RecoveryJournalDocument = { schemaVersion: RECOVERY_SCHEMA_VERSION, entries };
        await writeJsonFile(this.filePath, next);
        this.cache = next;
      }
      repaired = entries.map(cloneRecoveryEntry);
    });
    return repaired;
  }

  private async ensureLoaded(now = new Date()): Promise<RecoveryJournalDocument> {
    if (this.cache) return this.cache;
    const raw = await readRecoveryJournalJson(this.filePath);
    if (raw === MISSING_FILE) {
      this.cache = { schemaVersion: RECOVERY_SCHEMA_VERSION, entries: [] };
      return this.cache;
    }
    await repairJsonFilePermissions(this.filePath);
    const normalized = normalizeRecoveryDocument(raw, now);
    const next: RecoveryJournalDocument = { schemaVersion: RECOVERY_SCHEMA_VERSION, entries: normalized.entries };
    if (normalized.changed) await writeJsonFile(this.filePath, next);
    this.cache = next;
    return next;
  }

  private enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const run = this.pendingMutation.catch(() => undefined).then(operation);
    this.pendingMutation = run.catch(() => undefined);
    return run;
  }
}

async function readRecoveryJournalJson(filePath: string): Promise<unknown | typeof MISSING_FILE> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return MISSING_FILE;
    throw error;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Recovery journal is malformed; refusing to overwrite it.");
  }
}

export function isRecoveryStateUnresolved(state: RecoveryState): boolean {
  return state !== "delivered" && state !== "copied" && state !== "discarded" && state !== "expired";
}
