export const RECOVERY_SCHEMA_VERSION = 1;
export const RECOVERY_FIELD_MAX_LENGTH = 500;
export const RECOVERY_MAX_ATTEMPTS = 64;
export const RECOVERY_MAX_TRANSITION_IDS = 128;
export const DEFAULT_RECOVERY_RETENTION_MS = 72 * 60 * 60 * 1000;
export const RECOVERY_ENCRYPTION_VERSION = 1;

export type RecoveryMode = "full" | "text-only";

export type RecoveryState =
  | "capturing"
  | "interrupted_recording"
  | "captured"
  | "transcribing"
  | "transcript_ready"
  | "formatting"
  | "text_ready"
  | "inserting"
  | "retry_wait"
  | "recoverable"
  | "delivered"
  | "copied"
  | "discarded"
  | "expired";

export type RecoveryTerminalOutcome = "delivered" | "copied" | "discarded" | "expired";
export type RecoveryInsertionTerminalOutcome = "delivered" | "copied" | "recoverable";

export type RecoveryErrorClass =
  | "none"
  | "interrupted"
  | "recorder_failure"
  | "microphone_permission_denied"
  | "no_speech"
  | "timeout"
  | "transcription_error"
  | "formatting_error"
  | "insertion_failed"
  | "storage_failure"
  | "stale_session"
  | "recovery_key_unavailable"
  | "recovery_key_corrupt"
  | "recovery_cap_reached"
  | "recovery_storage_failure"
  | "authentication"
  | "invalid_config"
  | "permission_denied"
  | "malformed_audio"
  | "transient_network"
  | "rate_limit"
  | "provider_5xx"
  | "aborted"
  | "audio_route_changed"
  | "device_unavailable"
  | "native_load_failure"
  | "expired"
  | "unknown";

export interface RecoveryError {
  class: RecoveryErrorClass;
  detail?: string;
}

export interface RecoveryTargetFingerprint {
  appBundleId: string | null;
  appName: string | null;
  windowTitle: string | null;
}

export interface RecoveryAudioReference {
  kind: "encrypted-session-file";
  path: string;
  encryptionVersion?: typeof RECOVERY_ENCRYPTION_VERSION;
  sizeBytes?: number;
  sampleRate?: number;
  durationSeconds?: number;
  checksum?: string;
}

export interface RecoveryTextReferences {
  rawTranscript: string | null;
  cleanedText: string | null;
  formattedText: string | null;
}

export interface RecoveryInsertionOutcome {
  status: "pending" | "verified" | "failed";
  outcome?: "pending" | RecoveryInsertionTerminalOutcome;
  method?: "ax" | "clipboard" | null;
  reason?: RecoveryErrorClass;
  detail?: string;
  targetFingerprint?: RecoveryTargetFingerprint;
  appIdentity?: RecoveryTargetFingerprint;
  baselineReadable?: boolean;
  baselineHash?: string | null;
  textHash?: string;
  intendedStrategy?: "ax" | "clipboard";
  deadlineAt?: string | null;
}

export interface RecoveryInsertionView {
  status: "pending" | "verified" | "failed";
  outcome?: "pending" | RecoveryInsertionTerminalOutcome;
  method?: "ax" | "clipboard" | null;
  reason?: RecoveryErrorClass;
  detail?: string;
}

export interface RecoveryRetentionMetadata {
  expiresAt: string;
  audioExpiresAt: string | null;
  expiredAt: string | null;
}

export interface RecoveryRouteHandoff {
  generation: number;
  fromDeviceUid: string | null;
  toDeviceUid: string | null;
  occurredAt: string;
}

export type RecoveryLifecycleEvent = "sleep" | "wake" | "route-change" | "permission-revoked" | "permission-restored" | "capture-interrupted" | "native-load-failure";

export interface RecoveryLifecycleFacts {
  event: RecoveryLifecycleEvent;
  generation: number;
  occurredAt: string;
}

export interface RecoveryProviderAttempt {
  attempt: number;
  provider: string;
  startedAt: string;
  completedAt: string | null;
  deadlineAt: string | null;
  outcome: "started" | "succeeded" | "failed" | "cancelled";
  error?: RecoveryError;
}

export type RecoveryAttempt = RecoveryProviderAttempt;
export type RecoveryTarget = RecoveryTargetFingerprint;
export type RecoveryRetention = RecoveryRetentionMetadata;
export type RecoveryTerminal = RecoveryTerminalOutcome;

export interface RecoveryInsertionPreparation {
  targetFingerprint: RecoveryTargetFingerprint;
  appIdentity: RecoveryTargetFingerprint;
  baselineReadable: boolean;
  baselineHash: string | null;
  textHash: string;
  intendedStrategy: "ax" | "clipboard";
  deadlineAt: string;
}

export interface RecoveryEntry {
  schemaVersion: typeof RECOVERY_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  state: RecoveryState;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  buildIdentifier: string;
  target: RecoveryTargetFingerprint;
  deadlineAt: string | null;
  audio: RecoveryAudioReference | null;
  text: RecoveryTextReferences;
  insertion: RecoveryInsertionOutcome | null;
  providerAttempts: RecoveryProviderAttempt[];
  lastError: RecoveryError;
  retention: RecoveryRetentionMetadata;
  terminal: RecoveryTerminalOutcome | null;
  lastTransitionId: string | null;
  appliedTransitionIds: string[];
  recoveryMode: RecoveryMode;
  routeHandoff?: RecoveryRouteHandoff | null;
  lifecycle?: RecoveryLifecycleFacts | null;
}

/** Renderer-safe recovery data. File paths and other storage details stay in the main process. */
export interface RecoveryEntryView {
  id: string;
  state: RecoveryState;
  createdAt: string;
  updatedAt: string;
  appName: string | null;
  text: RecoveryTextReferences;
  insertion: RecoveryInsertionView | null;
  lastError: RecoveryError;
  retention: RecoveryRetentionMetadata;
  recoveryMode: RecoveryMode;
  terminal: RecoveryTerminalOutcome | null;
  audioAvailable: boolean;
  audioDurationSeconds: number | null;
}

export interface RecoveryStorageUsage {
  bytes: number;
  sessions: number;
}

export interface RecoveryRestoredNotice {
  entryIds: string[];
  count: number;
}

export interface RecoveryEntrySeed {
  id: string;
  sessionId: string;
  buildIdentifier: string;
  createdAt?: string;
  target?: Partial<RecoveryTargetFingerprint>;
  retentionMs?: number;
}

export interface RecoveryTransitionInput {
  entryId: string;
  sessionId: string;
  transitionId: string;
  to: RecoveryState;
  attempt: number;
  occurredAt: string;
  buildIdentifier: string;
  providerAttempt?: RecoveryProviderAttempt | null;
  providerAttempts?: RecoveryProviderAttempt[];
  deadlineAt?: string | null;
  audio?: RecoveryAudioReference | null;
  text?: Partial<RecoveryTextReferences>;
  insertion?: RecoveryInsertionOutcome | null;
  error?: RecoveryError;
  terminal?: RecoveryTerminalOutcome | null;
  routeHandoff?: RecoveryRouteHandoff | null;
  lifecycle?: RecoveryLifecycleFacts | null;
}

export const RECOVERY_TRANSITIONS: Readonly<Record<RecoveryState, readonly RecoveryState[]>> = {
  capturing: ["interrupted_recording", "captured", "recoverable"],
  interrupted_recording: ["captured", "transcribing", "recoverable", "expired"],
  captured: ["transcribing", "recoverable", "expired"],
  transcribing: ["transcript_ready", "retry_wait", "recoverable", "interrupted_recording", "expired"],
  transcript_ready: ["formatting", "text_ready", "copied", "recoverable", "expired"],
  formatting: ["text_ready", "recoverable", "expired"],
  text_ready: ["inserting", "copied", "recoverable", "expired"],
  inserting: ["delivered", "copied", "recoverable", "expired"],
  retry_wait: ["transcribing", "recoverable", "expired"],
  recoverable: ["retry_wait", "transcript_ready", "formatting", "text_ready", "copied", "delivered", "discarded", "expired"],
  delivered: [],
  copied: [],
  discarded: [],
  expired: [],
};

export class RecoveryTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryTransitionError";
  }
}

export function isTerminalRecoveryState(state: RecoveryState): state is RecoveryTerminalOutcome {
  return state === "delivered" || state === "copied" || state === "discarded" || state === "expired";
}

export function isLegalRecoveryTransition(from: RecoveryState, to: RecoveryState): boolean {
  return RECOVERY_TRANSITIONS[from].includes(to);
}

export function createRecoveryEntry(seed: RecoveryEntrySeed, now = new Date()): RecoveryEntry {
  const createdAt = validDate(seed.createdAt) ? seed.createdAt ?? now.toISOString() : now.toISOString();
  const retentionMs = Number.isFinite(seed.retentionMs) && (seed.retentionMs ?? 0) > 0
    ? Math.trunc(seed.retentionMs ?? DEFAULT_RECOVERY_RETENTION_MS)
    : DEFAULT_RECOVERY_RETENTION_MS;
  const target: RecoveryTargetFingerprint = {
    appBundleId: boundedOptional(seed.target?.appBundleId),
    appName: boundedOptional(seed.target?.appName),
    windowTitle: boundedOptional(seed.target?.windowTitle),
  };
  return {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    id: bounded(seed.id),
    sessionId: bounded(seed.sessionId),
    state: "capturing",
    attempt: 0,
    createdAt,
    updatedAt: createdAt,
    buildIdentifier: bounded(seed.buildIdentifier),
    target,
    deadlineAt: null,
    audio: null,
    text: { rawTranscript: null, cleanedText: null, formattedText: null },
    insertion: null,
    providerAttempts: [],
    lastError: { class: "none" },
    retention: {
      expiresAt: new Date(new Date(createdAt).getTime() + retentionMs).toISOString(),
      audioExpiresAt: new Date(new Date(createdAt).getTime() + retentionMs).toISOString(),
      expiredAt: null,
    },
    terminal: null,
    lastTransitionId: null,
    appliedTransitionIds: [],
    recoveryMode: "full",
    routeHandoff: null,
    lifecycle: null,
  };
}

export function applyRecoveryTransition(entry: RecoveryEntry, input: RecoveryTransitionInput): RecoveryEntry {
  if (input.sessionId !== entry.sessionId) {
    throw new RecoveryTransitionError("Stale recovery session.");
  }
  const transitionId = bounded(input.transitionId);
  if (entry.appliedTransitionIds.includes(transitionId)) return cloneRecoveryEntry(entry);
  if (isTerminalRecoveryState(entry.state)) {
    throw new RecoveryTransitionError("Terminal recovery entries cannot transition.");
  }
  if (!isLegalRecoveryTransition(entry.state, input.to)) {
    throw new RecoveryTransitionError(`Invalid recovery transition: ${entry.state} -> ${input.to}.`);
  }
  if (isTerminalRecoveryState(input.to) && input.terminal !== null && input.terminal !== undefined && input.terminal !== input.to) {
    throw new RecoveryTransitionError("Terminal outcome does not match the destination state.");
  }
  if (input.attempt !== entry.attempt + 1) {
    throw new RecoveryTransitionError("Recovery attempt must increase monotonically.");
  }
  if (!validDate(input.occurredAt)) {
    throw new RecoveryTransitionError("Recovery transition timestamp is invalid.");
  }
  const next: RecoveryEntry = {
    ...cloneRecoveryEntry(entry),
    state: input.to,
    attempt: input.attempt,
    updatedAt: bounded(input.occurredAt),
    buildIdentifier: bounded(input.buildIdentifier),
    deadlineAt: input.deadlineAt === undefined ? entry.deadlineAt : boundedOptional(input.deadlineAt),
    audio: input.audio === undefined ? entry.audio : sanitizeAudio(input.audio),
    text: mergeText(entry.text, input.text),
    insertion: input.insertion === undefined ? entry.insertion : sanitizeInsertion(input.insertion),
    lastError: input.error ? sanitizeError(input.error) : entry.lastError,
    terminal: isTerminalRecoveryState(input.to) ? input.terminal ?? input.to : null,
    lastTransitionId: transitionId,
    appliedTransitionIds: [...entry.appliedTransitionIds, transitionId].slice(-RECOVERY_MAX_TRANSITION_IDS),
    recoveryMode: entry.recoveryMode,
    routeHandoff: input.routeHandoff === undefined ? entry.routeHandoff ?? null : sanitizeRouteHandoff(input.routeHandoff),
    lifecycle: input.lifecycle === undefined ? entry.lifecycle ?? null : sanitizeLifecycleFacts(input.lifecycle),
  };
  if (input.providerAttempt) {
    next.providerAttempts = [...entry.providerAttempts, sanitizeProviderAttempt(input.providerAttempt)].slice(-RECOVERY_MAX_ATTEMPTS);
  }
  if (input.providerAttempts) {
    next.providerAttempts = [...entry.providerAttempts, ...input.providerAttempts.map(sanitizeProviderAttempt)].slice(-RECOVERY_MAX_ATTEMPTS);
  }
  if (input.to === "expired") {
    next.lastError = { class: "expired" };
    next.retention = { ...next.retention, expiredAt: bounded(input.occurredAt) };
  }
  return next;
}

export function sanitizeRecoveryEntry(entry: RecoveryEntry): RecoveryEntry {
  const normalized = createRecoveryEntry({
    id: entry.id,
    sessionId: entry.sessionId,
    buildIdentifier: entry.buildIdentifier,
    createdAt: entry.createdAt,
    target: entry.target,
  });
  const next: RecoveryEntry = {
    ...normalized,
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    state: isRecoveryState(entry.state) ? entry.state : "recoverable",
    attempt: boundedAttempt(entry.attempt),
    updatedAt: validDate(entry.updatedAt) ? bounded(entry.updatedAt) : normalized.updatedAt,
    deadlineAt: boundedOptional(entry.deadlineAt),
    audio: sanitizeAudio(entry.audio),
    text: mergeText(normalized.text, entry.text),
    insertion: sanitizeInsertion(entry.insertion),
    providerAttempts: Array.isArray(entry.providerAttempts)
      ? entry.providerAttempts.slice(-RECOVERY_MAX_ATTEMPTS).map(sanitizeProviderAttempt)
      : [],
    lastError: sanitizeError(entry.lastError),
    retention: sanitizeRetention(entry.retention, normalized.retention),
    terminal: isTerminalRecoveryState(entry.state) ? entry.terminal ?? entry.state : null,
    lastTransitionId: boundedOptional(entry.lastTransitionId),
    appliedTransitionIds: Array.isArray(entry.appliedTransitionIds)
      ? entry.appliedTransitionIds.filter((id): id is string => typeof id === "string").map(bounded).slice(-RECOVERY_MAX_TRANSITION_IDS)
      : [],
    recoveryMode: entry.recoveryMode === "text-only" ? "text-only" : "full",
    routeHandoff: sanitizeRouteHandoff(entry.routeHandoff),
    lifecycle: sanitizeLifecycleFacts(entry.lifecycle),
  };
  return next;
}

export function repairRecoveryEntry(entry: RecoveryEntry, now = new Date()): RecoveryEntry {
  const normalized = sanitizeRecoveryEntry(entry);
  if (normalized.terminal) return normalized;
  const wasActive = normalized.state === "capturing" || normalized.state === "transcribing" || normalized.state === "transcript_ready" || normalized.state === "formatting" || normalized.state === "text_ready" || normalized.state === "inserting";
  const interruptedState: RecoveryState = normalized.state === "capturing" ? "interrupted_recording" : "recoverable";
  const interrupted: RecoveryEntry = wasActive
    ? {
        ...normalized,
        state: interruptedState,
        attempt: Math.min(normalized.attempt + 1, Number.MAX_SAFE_INTEGER),
        updatedAt: now.toISOString(),
        lastError: { class: "interrupted", detail: "Recovered after process restart." },
        lastTransitionId: bounded(`startup:${normalized.id}:${normalized.updatedAt}`),
      }
    : normalized;
  if (!validDate(interrupted.retention.expiresAt) || new Date(interrupted.retention.expiresAt) > now) {
    return interrupted;
  }
  if (interrupted.state === "expired") {
    return interrupted;
  }
  if (interrupted.terminal) {
    return interrupted;
  }
  return {
    ...interrupted,
    state: "expired",
    attempt: Math.min(normalized.attempt + 1, Number.MAX_SAFE_INTEGER),
    updatedAt: now.toISOString(),
    lastError: { class: "expired" },
    retention: { ...normalized.retention, expiredAt: now.toISOString() },
    terminal: "expired",
    lastTransitionId: bounded(`expiry:${normalized.id}:${normalized.retention.expiresAt}`),
  };
}

export function normalizeRecoveryDocument(raw: unknown, now = new Date()): { entries: RecoveryEntry[]; changed: boolean } {
  if (!Array.isArray(raw) && !(isRecord(raw) && Array.isArray(raw.entries))) {
    throw new Error("Recovery journal has an invalid JSON shape.");
  }
  const sourceEntries = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.entries) ? raw.entries : [];
  const entries = sourceEntries
    .filter(isRecord)
    .map((value, index) => migrateRecoveryEntry(value, index, now))
    .map((entry) => repairRecoveryEntry(entry, now));
  const expected = JSON.stringify({ schemaVersion: RECOVERY_SCHEMA_VERSION, entries });
  const actual = JSON.stringify(raw);
  return { entries, changed: expected !== actual };
}

export function cloneRecoveryEntry(entry: RecoveryEntry): RecoveryEntry {
  return structuredClone(entry);
}

export function toRecoveryEntryView(entry: RecoveryEntry): RecoveryEntryView {
  const safeEntry = sanitizeRecoveryEntry(entry);
  return {
    id: safeEntry.id,
    state: safeEntry.state,
    createdAt: safeEntry.createdAt,
    updatedAt: safeEntry.updatedAt,
    appName: safeEntry.target.appName,
    text: structuredClone(safeEntry.text),
    insertion: safeEntry.insertion ? {
      status: safeEntry.insertion.status,
      ...(safeEntry.insertion.outcome ? { outcome: safeEntry.insertion.outcome } : {}),
      method: safeEntry.insertion.method ?? null,
      ...(safeEntry.insertion.reason ? { reason: safeEntry.insertion.reason } : {}),
      ...(safeEntry.insertion.detail ? { detail: safeEntry.insertion.detail } : {}),
    } : null,
    lastError: structuredClone(safeEntry.lastError),
    retention: structuredClone(safeEntry.retention),
    recoveryMode: safeEntry.recoveryMode,
    terminal: safeEntry.terminal,
    audioAvailable: safeEntry.audio !== null,
    audioDurationSeconds: safeEntry.audio?.durationSeconds ?? null,
  };
}

export function bounded(value: string): string {
  return redactSensitiveText(value).slice(0, RECOVERY_FIELD_MAX_LENGTH);
}

function boundedOptional(value: string | null | undefined): string | null {
  return typeof value === "string" ? bounded(value) : null;
}

function validDate(value: string | undefined | null): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function boundedAttempt(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(Math.trunc(value), Number.MAX_SAFE_INTEGER)) : 0;
}

function sanitizeError(error: RecoveryError | null | undefined): RecoveryError {
  if (!error || !isRecoveryErrorClass(error.class)) return { class: "unknown" };
  return { class: error.class, ...(typeof error.detail === "string" ? { detail: bounded(error.detail) } : {}) };
}

function sanitizeAudio(audio: RecoveryAudioReference | null | undefined): RecoveryAudioReference | null {
  if (!audio || audio.kind !== "encrypted-session-file" || typeof audio.path !== "string") return null;
  return {
    kind: audio.kind,
    path: bounded(audio.path),
    ...(audio.encryptionVersion === RECOVERY_ENCRYPTION_VERSION ? { encryptionVersion: RECOVERY_ENCRYPTION_VERSION } : {}),
    ...(finiteNonNegative(audio.sizeBytes) ? { sizeBytes: audio.sizeBytes } : {}),
    ...(finiteNonNegative(audio.sampleRate) ? { sampleRate: audio.sampleRate } : {}),
    ...(finiteNonNegative(audio.durationSeconds) ? { durationSeconds: audio.durationSeconds } : {}),
    ...(typeof audio.checksum === "string" ? { checksum: bounded(audio.checksum) } : {}),
  };
}

function sanitizeInsertion(insertion: RecoveryInsertionOutcome | null | undefined): RecoveryInsertionOutcome | null {
  if (!insertion || !["pending", "verified", "failed"].includes(insertion.status)) return null;
  const outcome = insertion.outcome === "delivered" || insertion.outcome === "copied" || insertion.outcome === "recoverable" || insertion.outcome === "pending"
    ? insertion.outcome
    : undefined;
  return {
    status: insertion.status,
    ...(outcome ? { outcome } : {}),
    method: insertion.method === "ax" || insertion.method === "clipboard" ? insertion.method : null,
    ...(isRecoveryErrorClass(insertion.reason) ? { reason: insertion.reason } : {}),
    ...(typeof insertion.detail === "string" ? { detail: bounded(insertion.detail) } : {}),
    ...(insertion.targetFingerprint ? { targetFingerprint: sanitizeTarget(insertion.targetFingerprint) } : {}),
    ...(insertion.appIdentity ? { appIdentity: sanitizeTarget(insertion.appIdentity) } : {}),
    ...(typeof insertion.baselineReadable === "boolean" ? { baselineReadable: insertion.baselineReadable } : {}),
    ...(typeof insertion.baselineHash === "string" ? { baselineHash: bounded(insertion.baselineHash) } : { baselineHash: null }),
    ...(typeof insertion.textHash === "string" ? { textHash: bounded(insertion.textHash) } : {}),
    ...(insertion.intendedStrategy === "ax" || insertion.intendedStrategy === "clipboard" ? { intendedStrategy: insertion.intendedStrategy } : {}),
    ...(insertion.deadlineAt === null || typeof insertion.deadlineAt === "string" ? { deadlineAt: boundedOptional(insertion.deadlineAt) } : {}),
  };
}

function sanitizeTarget(target: RecoveryTargetFingerprint): RecoveryTargetFingerprint {
  return {
    appBundleId: boundedOptional(target.appBundleId),
    appName: boundedOptional(target.appName),
    windowTitle: boundedOptional(target.windowTitle),
  };
}

function sanitizeProviderAttempt(attempt: RecoveryProviderAttempt): RecoveryProviderAttempt {
  return {
    attempt: boundedAttempt(attempt.attempt),
    provider: bounded(attempt.provider),
    startedAt: validDate(attempt.startedAt) ? bounded(attempt.startedAt) : new Date(0).toISOString(),
    completedAt: boundedOptional(attempt.completedAt),
    deadlineAt: boundedOptional(attempt.deadlineAt),
    outcome: ["started", "succeeded", "failed", "cancelled"].includes(attempt.outcome) ? attempt.outcome : "failed",
    ...(attempt.error ? { error: sanitizeError(attempt.error) } : {}),
  };
}

function sanitizeRetention(retention: RecoveryRetentionMetadata | null | undefined, fallback: RecoveryRetentionMetadata): RecoveryRetentionMetadata {
  return {
    expiresAt: validDate(retention?.expiresAt) ? bounded(retention?.expiresAt ?? fallback.expiresAt) : fallback.expiresAt,
    audioExpiresAt: validDate(retention?.audioExpiresAt) ? bounded(retention?.audioExpiresAt ?? fallback.audioExpiresAt) : null,
    expiredAt: validDate(retention?.expiredAt) ? bounded(retention?.expiredAt ?? null) : null,
  };
}

function sanitizeRouteHandoff(handoff: RecoveryRouteHandoff | null | undefined): RecoveryRouteHandoff | null {
  if (!handoff || !Number.isSafeInteger(handoff.generation) || handoff.generation < 0 || !validDate(handoff.occurredAt)) return null;
  return {
    generation: handoff.generation,
    fromDeviceUid: boundedOptional(handoff.fromDeviceUid),
    toDeviceUid: boundedOptional(handoff.toDeviceUid),
    occurredAt: bounded(handoff.occurredAt),
  };
}

function sanitizeLifecycleFacts(facts: RecoveryLifecycleFacts | null | undefined): RecoveryLifecycleFacts | null {
  const events: readonly RecoveryLifecycleEvent[] = ["sleep", "wake", "route-change", "permission-revoked", "permission-restored", "capture-interrupted", "native-load-failure"];
  if (!facts || !events.includes(facts.event) || !Number.isSafeInteger(facts.generation) || facts.generation < 0 || !validDate(facts.occurredAt)) return null;
  return { event: facts.event, generation: facts.generation, occurredAt: bounded(facts.occurredAt) };
}

function mergeText(current: RecoveryTextReferences, patch: Partial<RecoveryTextReferences> | null | undefined): RecoveryTextReferences {
  return {
    rawTranscript: patch?.rawTranscript === undefined ? boundedOptional(current.rawTranscript) : boundedOptional(patch.rawTranscript),
    cleanedText: patch?.cleanedText === undefined ? boundedOptional(current.cleanedText) : boundedOptional(patch.cleanedText),
    formattedText: patch?.formattedText === undefined ? boundedOptional(current.formattedText) : boundedOptional(patch.formattedText),
  };
}

function migrateRecoveryEntry(value: Record<string, unknown>, index: number, now: Date): RecoveryEntry {
  const id = typeof value.id === "string" ? value.id : crypto.randomUUID();
  const legacyState = typeof value.state === "string" ? value.state : value.status;
  const state = migrateState(legacyState);
  const target = isRecord(value.target) ? value.target : value;
  const text = isRecord(value.text) ? value.text : value;
  const rawText = typeof text.rawTranscript === "string"
    ? text.rawTranscript
    : typeof text.rawText === "string" ? text.rawText : null;
  const cleanedText = typeof text.cleanedText === "string" ? text.cleanedText : null;
  const entry = createRecoveryEntry({
    id,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : `legacy-${id}`,
    buildIdentifier: typeof value.buildIdentifier === "string" ? value.buildIdentifier : "legacy",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : typeof value.timestamp === "string" ? value.timestamp : now.toISOString(),
    target: {
      appBundleId: typeof target.appBundleId === "string" ? target.appBundleId : null,
      appName: typeof target.appName === "string" ? target.appName : null,
      windowTitle: typeof target.windowTitle === "string" ? target.windowTitle : null,
    },
  });
  entry.state = state;
  entry.attempt = boundedAttempt(typeof value.attempt === "number" ? value.attempt : 0);
  entry.updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : entry.createdAt;
  entry.deadlineAt = typeof value.deadlineAt === "string" ? value.deadlineAt : null;
  entry.audio = parseAudio(value.audio);
  entry.text = {
    rawTranscript: rawText,
    cleanedText,
    formattedText: typeof text.formattedText === "string" ? text.formattedText : null,
  };
  entry.insertion = parseInsertion(value.insertion);
  entry.providerAttempts = Array.isArray(value.providerAttempts)
    ? value.providerAttempts.map(parseProviderAttempt).filter((attempt): attempt is RecoveryProviderAttempt => attempt !== null)
    : [];
  entry.lastError = parseError(value.lastError) ?? sanitizeError({
    class: isRecoveryErrorClass(value.errorClass) ? value.errorClass : "none",
    detail: typeof value.errorDetail === "string" ? value.errorDetail : undefined,
  });
  if (isRecord(value.retention)) {
    entry.retention = {
      expiresAt: typeof value.retention.expiresAt === "string" ? value.retention.expiresAt : entry.retention.expiresAt,
      audioExpiresAt: typeof value.retention.audioExpiresAt === "string" ? value.retention.audioExpiresAt : null,
      expiredAt: typeof value.retention.expiredAt === "string" ? value.retention.expiredAt : null,
    };
  }
  entry.lastTransitionId = typeof value.lastTransitionId === "string" ? value.lastTransitionId : null;
  entry.appliedTransitionIds = Array.isArray(value.appliedTransitionIds)
    ? value.appliedTransitionIds.filter((id): id is string => typeof id === "string")
    : [];
  if (isTerminalRecoveryState(state)) entry.terminal = state;
  entry.recoveryMode = value.recoveryMode === "text-only" ? "text-only" : "full";
  entry.routeHandoff = parseRouteHandoff(value.routeHandoff);
  entry.lifecycle = parseLifecycleFacts(value.lifecycle);
  if (index < 0) entry.id = crypto.randomUUID();
  return sanitizeRecoveryEntry(entry);
}

function parseAudio(value: unknown): RecoveryAudioReference | null {
  if (!isRecord(value) || value.kind !== "encrypted-session-file" || typeof value.path !== "string") return null;
  return {
    kind: "encrypted-session-file",
    path: value.path,
    ...(value.encryptionVersion === RECOVERY_ENCRYPTION_VERSION ? { encryptionVersion: RECOVERY_ENCRYPTION_VERSION } : {}),
    ...(typeof value.sizeBytes === "number" ? { sizeBytes: value.sizeBytes } : {}),
    ...(typeof value.sampleRate === "number" ? { sampleRate: value.sampleRate } : {}),
    ...(typeof value.durationSeconds === "number" ? { durationSeconds: value.durationSeconds } : {}),
    ...(typeof value.checksum === "string" ? { checksum: value.checksum } : {}),
  };
}

function parseRouteHandoff(value: unknown): RecoveryRouteHandoff | null {
  if (!isRecord(value) || typeof value.generation !== "number" || !Number.isSafeInteger(value.generation) || value.generation < 0 || typeof value.occurredAt !== "string" || !validDate(value.occurredAt)) return null;
  return {
    generation: value.generation,
    fromDeviceUid: typeof value.fromDeviceUid === "string" ? value.fromDeviceUid : null,
    toDeviceUid: typeof value.toDeviceUid === "string" ? value.toDeviceUid : null,
    occurredAt: value.occurredAt,
  };
}

function parseLifecycleFacts(value: unknown): RecoveryLifecycleFacts | null {
  if (!isRecord(value) || typeof value.event !== "string" || typeof value.generation !== "number" || !Number.isSafeInteger(value.generation) || value.generation < 0 || typeof value.occurredAt !== "string" || !validDate(value.occurredAt)) return null;
  if (!isRecoveryLifecycleEvent(value.event)) return null;
  return { event: value.event, generation: value.generation, occurredAt: value.occurredAt };
}

function isRecoveryLifecycleEvent(value: unknown): value is RecoveryLifecycleEvent {
  return ["sleep", "wake", "route-change", "permission-revoked", "permission-restored", "capture-interrupted", "native-load-failure"].some((candidate) => candidate === value);
}

function parseInsertion(value: unknown): RecoveryInsertionOutcome | null {
  if (!isRecord(value) || (value.status !== "pending" && value.status !== "verified" && value.status !== "failed")) return null;
  const targetFingerprint = isRecord(value.targetFingerprint) ? parseTargetFingerprint(value.targetFingerprint) : undefined;
  const appIdentity = isRecord(value.appIdentity) ? parseTargetFingerprint(value.appIdentity) : undefined;
  return {
    status: value.status,
    ...(value.outcome === "pending" || value.outcome === "delivered" || value.outcome === "copied" || value.outcome === "recoverable" ? { outcome: value.outcome } : {}),
    method: value.method === "ax" || value.method === "clipboard" ? value.method : null,
    ...(isRecoveryErrorClass(value.reason) ? { reason: value.reason } : {}),
    ...(typeof value.detail === "string" ? { detail: value.detail } : {}),
    ...(targetFingerprint ? { targetFingerprint } : {}),
    ...(appIdentity ? { appIdentity } : {}),
    ...(typeof value.baselineReadable === "boolean" ? { baselineReadable: value.baselineReadable } : {}),
    ...(typeof value.baselineHash === "string" ? { baselineHash: value.baselineHash } : { baselineHash: null }),
    ...(typeof value.textHash === "string" ? { textHash: value.textHash } : {}),
    ...(value.intendedStrategy === "ax" || value.intendedStrategy === "clipboard" ? { intendedStrategy: value.intendedStrategy } : {}),
    ...(value.deadlineAt === null || typeof value.deadlineAt === "string" ? { deadlineAt: value.deadlineAt } : {}),
  };
}

function parseTargetFingerprint(value: Record<string, unknown>): RecoveryTargetFingerprint {
  return {
    appBundleId: typeof value.appBundleId === "string" ? value.appBundleId : null,
    appName: typeof value.appName === "string" ? value.appName : null,
    windowTitle: typeof value.windowTitle === "string" ? value.windowTitle : null,
  };
}

function parseProviderAttempt(value: unknown): RecoveryProviderAttempt | null {
  if (!isRecord(value) || typeof value.provider !== "string" || typeof value.startedAt !== "string") return null;
  const outcome = value.outcome;
  if (outcome !== "started" && outcome !== "succeeded" && outcome !== "failed" && outcome !== "cancelled") return null;
  const error = parseError(value.error);
  return {
    attempt: typeof value.attempt === "number" ? value.attempt : 0,
    provider: value.provider,
    startedAt: value.startedAt,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : null,
    deadlineAt: typeof value.deadlineAt === "string" ? value.deadlineAt : null,
    outcome,
    ...(error ? { error } : {}),
  };
}

function parseError(value: unknown): RecoveryError | null {
  if (!isRecord(value) || !isRecoveryErrorClass(value.class)) return null;
  return { class: value.class, ...(typeof value.detail === "string" ? { detail: value.detail } : {}) };
}

function migrateState(value: unknown): RecoveryState {
  if (isRecoveryState(value)) return value;
  if (value === "recording") return "capturing";
  if (value === "failed" || value === "pending" || value === "saved") return "recoverable";
  if (value === "success" || value === "completed" || value === "injected") return "delivered";
  return "recoverable";
}

function isRecoveryState(value: unknown): value is RecoveryState {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RECOVERY_TRANSITIONS, value);
}

function isRecoveryErrorClass(value: unknown): value is RecoveryErrorClass {
  const classes: readonly RecoveryErrorClass[] = [
    "none", "interrupted", "recorder_failure", "microphone_permission_denied", "no_speech", "timeout",
    "transcription_error", "formatting_error", "insertion_failed", "storage_failure", "stale_session", "recovery_key_unavailable", "recovery_key_corrupt", "recovery_cap_reached", "recovery_storage_failure", "authentication", "invalid_config", "permission_denied", "malformed_audio", "transient_network", "rate_limit", "provider_5xx", "aborted", "audio_route_changed", "device_unavailable", "native_load_failure", "expired", "unknown",
  ];
  return typeof value === "string" && classes.some((candidate) => candidate === value);
}

function finiteNonNegative(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(?:gsk_|sk-|bearer\s+)[A-Za-z0-9._-]+/gi, "[redacted]")
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");
}
