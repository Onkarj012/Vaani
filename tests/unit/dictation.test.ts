import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { captureSessionSettings } from "@shared/sessionSettings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import { IpcChannel } from "@shared/ipc";
import { pcmToAudioClip } from "@shared/pcmUtils";
import type { AudioClip, AudioVisualFrame, DictationEntry, DictationTrace, InjectionResult, Settings, TranscriptionResult } from "@shared/types";
import type { DictationTraceStore } from "@main/store/dictationTrace";
import type { RecoveryJournalStore } from "@main/store/recoveryJournal";
import type { EncryptedRecoveryAudioStore } from "@main/audio/recoveryAudio";
import { createRecoveryEntry, type RecoveryEntry, type RecoveryEntrySeed, type RecoveryErrorClass, type RecoveryInsertionPreparation, type RecoveryTransitionInput } from "@shared/recovery";
import { DictationService } from "./dictation.fixture";
import { selectRecoveryText } from "@main/dictation";
import { nativeBridge } from "@main/nativeBridge";
import type { InjectionOptions, InjectionTarget } from "@main/injection";
import { TranscriptionDeadlineExceededError, TranscriptionService, type TranscribeOptions } from "@main/transcription";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getVersion: () => "1.1.3",
    getName: () => "Vaani Test",
    getPath: (name: string) => `/tmp/vaani-test/${name}`,
    setActivationPolicy: () => {},
    dock: {
      show: () => Promise.resolve(),
      hide: () => {}
    }
  },
  BrowserWindow: class BrowserWindowMock {},
  session: {
    defaultSession: {
      setPermissionRequestHandler: () => {}
    }
  },
  systemPreferences: {
    getMediaAccessStatus: vi.fn(() => "granted"),
    isTrustedAccessibilityClient: vi.fn(() => true),
    askForMediaAccess: vi.fn(async () => true)
  }
}));

const groqCreate = vi.hoisted(() => vi.fn());

vi.mock("groq-sdk", () => ({
  default: class {
    chat = { completions: { create: groqCreate } };
  },
}));

function createDictationService(deps: {
  traces?: Pick<DictationTraceStore, "upsert" | "updateById" | "getById" | "getBySessionId"> & Partial<Pick<DictationTraceStore, "getAll">>;
  getMicrophonePermission?: () => string;
  recovery?: Pick<RecoveryJournalStore, "create" | "getById" | "transition"> & Partial<Pick<RecoveryJournalStore, "prepareInsertion" | "recordInsertionOutcome" | "updateRecoveryMode" | "markRouteHandoff">>;
  recoveryAudio?: Pick<EncryptedRecoveryAudioStore, "spool" | "deleteForSession" | "withDecryptedAudio">;
  recoveryReady?: () => boolean;
  copyText?: (text: string) => Promise<boolean> | boolean;
  focusedIdentity?: () => string | null;
  onVerifySleep?: () => void;
} = {}) {
  let verifierTimeMs = 0;
  let focusedValue = "";
  let focusedElementIdentity = "test-field";
  (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn(() => focusedValue);
  (nativeBridge as { getFocusedSelection?: () => { location: number; length: number } | null }).getFocusedSelection = vi.fn(() => ({
    location: focusedValue.length,
    length: 0,
  }));
  (nativeBridge as { getFocusedElementIdentity?: () => string | null }).getFocusedElementIdentity = deps.focusedIdentity ?? vi.fn(() => focusedElementIdentity);

  const overlay = {
    setPressed: vi.fn(),
    setRecording: vi.fn(),
    setProcessing: vi.fn(),
    setSuccess: vi.fn(),
    setError: vi.fn(),
    setStatusMessage: vi.fn(),
    hide: vi.fn(),
    updateBars: vi.fn(),
    showDictionaryPrompt: vi.fn((_spoken: string, _written: string, resolve: (accepted: boolean) => void) => resolve(true)),
    showSnippetPrompt: vi.fn((_trigger: string, resolve: (accepted: boolean) => void) => resolve(true))
  };

  const mainWindow = {
    webContents: {
      send: vi.fn()
    }
  };

  const settings = {
    get: vi.fn(() => DEFAULT_SETTINGS),
    update: vi.fn((patch) => ({ ...DEFAULT_SETTINGS, ...patch }))
  };

  const history = {
    append: vi.fn(),
    updateById: vi.fn(),
    getById: vi.fn(),
    getLatest: vi.fn(),
    clear: vi.fn()
  };

  const recorder = {
    isReady: vi.fn(() => true),
    startRecording: vi.fn(() => true),
    stopRecording: vi.fn(() => true),
    abortRecording: vi.fn()
  };

  const transcription = {
    transcribe: vi.fn(async (_clip: AudioClip, _options?: TranscribeOptions): Promise<TranscriptionResult> => ({ rawText: "open get hub", formattedText: "open get hub", language: "en" })),
    formatTranscript: vi.fn(async (text: string) => text)
  };

  const injector = {
    inject: vi.fn(async (text: string, _target?: InjectionTarget, _options?: InjectionOptions): Promise<InjectionResult> => {
      focusedValue += text;
      return { success: true, method: "clipboard" };
    })
  };

  const appDetector = {
    getContext: vi.fn(() => ({ appBundleId: "com.apple.TextEdit", appName: "TextEdit", context: "default" as const }))
  };

  const service = new DictationService(
    mainWindow as never,
    settings as never,
    history as never,
    vi.fn(),
    overlay as never,
    {
      recorder,
      transcription,
      injector,
      appDetector,
      traces: deps.traces,
      recovery: deps.recovery,
      recoveryAudio: deps.recoveryAudio,
      recoveryReady: deps.recoveryReady,
      copyText: deps.copyText,
      getMicrophonePermission: deps.getMicrophonePermission,
      verifierNow: () => verifierTimeMs,
      verifierSleep: async (ms: number) => { verifierTimeMs += ms; deps.onVerifySleep?.(); },
    }
  );

  return { service, overlay, mainWindow, history, recorder, settings, transcription, injector, appDetector, verifierTime: () => verifierTimeMs };
}

function createTraceDeps() {
  let trace: DictationTrace | null = null;
  const traces: Pick<DictationTraceStore, "upsert" | "updateById" | "getById" | "getBySessionId"> = {
    upsert: vi.fn(async (next: DictationTrace) => { trace = next; }),
    updateById: vi.fn(async (_id: string, updater: (current: DictationTrace) => DictationTrace) => {
      if (!trace) throw new Error("Trace was not initialized.");
      trace = updater(trace);
      return trace;
    }),
    getById: vi.fn(async () => trace ?? undefined),
    getBySessionId: vi.fn(async () => trace ?? undefined),
  };
  return { traces, getTrace: () => trace };
}

function createInsertionRecovery(sessionId: string) {
  let entry: RecoveryEntry = createRecoveryEntry({ id: sessionId, sessionId, buildIdentifier: "1.0.0+abc1234", settingsSnapshot: captureSessionSettings(DEFAULT_SETTINGS) });
  const recovery = {
    create: vi.fn(async (next: RecoveryEntry | RecoveryEntrySeed) => { entry = "schemaVersion" in next ? next : createRecoveryEntry(next); return entry; }),
    getById: vi.fn(async () => entry),
    transition: vi.fn(async (input: RecoveryTransitionInput) => {
      entry = {
        ...entry,
        state: input.to,
        attempt: input.attempt,
        text: { ...entry.text, ...input.text },
      };
      return entry;
    }),
    prepareInsertion: vi.fn(async (_id: string, _sessionId: string, preparation: RecoveryInsertionPreparation) => {
      entry = { ...entry, insertion: { status: "pending", outcome: "pending", ...preparation } };
      return entry;
    }),
    recordInsertionOutcome: vi.fn(async (_id: string, _sessionId: string, outcome: "delivered" | "copied" | "recoverable", details: { method?: "ax" | "clipboard" | null; reason?: RecoveryErrorClass; detail?: string } = {}) => {
      entry = { ...entry, insertion: { ...(entry.insertion ?? { status: "pending" }), status: outcome === "delivered" ? "verified" : "failed", outcome, ...details }, terminal: outcome === "recoverable" ? null : outcome, state: outcome === "delivered" ? "delivered" : outcome === "copied" ? "copied" : "recoverable" };
      return entry;
    }),
  };
  return { recovery, getEntry: () => entry };
}

type MockedSettingsStore = ReturnType<typeof createDictationService>["settings"];

function makeSettingsMutable(settings: MockedSettingsStore, initial: Settings = DEFAULT_SETTINGS) {
  let current: Settings = {
    ...initial,
    customCorrections: [...initial.customCorrections],
    snippets: [...initial.snippets],
    providerApiKeys: [...initial.providerApiKeys],
  };
  if (initial.appProfiles) current = { ...current, appProfiles: [...initial.appProfiles] };
  settings.get.mockImplementation(() => current);
  settings.update.mockImplementation((patch) => {
    current = { ...current, ...patch };
    return current;
  });
  return { current: () => current };
}

// Alternating samples at a fixed amplitude, run through the same conversion the recorder uses.
function steadyClip(amplitude: number): AudioClip {
  return pcmToAudioClip(new Float32Array(16_000).map((_, index) => (index % 2 === 0 ? amplitude : -amplitude)), 16_000);
}

async function submitClip(service: ReturnType<typeof createDictationService>["service"], clip: AudioClip): Promise<void> {
  service.beginHotkeySession();
  const sessionId = (service.getState() as { sessionId: string }).sessionId;
  service.reportRecorderStarted(sessionId);
  service.endHotkeySession();
  await service.submitAudioClip({ sessionId, clip });
}

async function submitHelloWorld(service: ReturnType<typeof createDictationService>["service"]): Promise<void> {
  service.beginHotkeySession();
  const sessionId = (service.getState() as { sessionId: string }).sessionId;
  service.reportRecorderStarted(sessionId);
  service.endHotkeySession();
  await service.submitAudioClip({
    sessionId,
    clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
  });
}

describe("DictationService", () => {
  it("keeps live transcription on its normal path when recovery is ready", async () => {
    const { service, transcription } = createDictationService({ recoveryReady: () => true });
    await submitHelloWorld(service);
    expect(transcription.transcribe.mock.calls[0]?.[1]?.recovery).toBeUndefined();
  });

  it("does not replace a verified trace when cancellation follows completion", async () => {
    const traceDeps = createTraceDeps();
    const { service } = createDictationService({ traces: traceDeps.traces });
    await submitHelloWorld(service);
    expect(traceDeps.getTrace()?.outcome).toBe("verified");
    service.cancelSession();
    await Promise.resolve();
    expect(traceDeps.getTrace()?.outcome).toBe("verified");
  });

  it("keeps a dispatched transcript in History when a new hotkey supersedes it", async () => {
    const { service, injector, history } = createDictationService();
    let finishInjection: (result: InjectionResult) => void = () => undefined;
    injector.inject.mockImplementationOnce((_text, _target, options) => {
      options?.onDispatch?.();
      return new Promise<InjectionResult>((resolve) => { finishInjection = resolve; });
    });
    const submission = submitHelloWorld(service);
    await vi.waitFor(() => expect(injector.inject).toHaveBeenCalledOnce());
    service.beginHotkeySession();
    finishInjection({ success: true, method: "clipboard" });
    await submission;
    await vi.waitFor(() => expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ cleanedText: "Open get hub.", injectionStatus: "saved" })));
    expect(history.append).toHaveBeenCalledTimes(1);
  });

  it("stops verification when the session is cancelled during a poll wait", async () => {
    let service: ReturnType<typeof createDictationService>["service"];
    let cancelled = false;
    const harness = createDictationService({ onVerifySleep: () => {
      if (!cancelled) { cancelled = true; service.cancelSession(); }
    } });
    service = harness.service;
    harness.injector.inject.mockImplementationOnce(async (_text, _target, options) => {
      options?.onDispatch?.();
      return { success: true, method: "clipboard" };
    });
    await submitHelloWorld(service);
    await vi.advanceTimersByTimeAsync(0);
    expect(cancelled).toBe(true);
    expect(harness.injector.inject).toHaveBeenCalledOnce();
    expect(harness.history.append).toHaveBeenCalledTimes(1);
    expect(harness.history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved" }));
  });

  it.each([
    { start: false, finish: false, count: 0 },
    { start: false, finish: true, count: 0 },
    { start: true, finish: false, count: 0 },
    { start: true, finish: true, count: 1 },
  ])("requires start and current WAV consent ($start -> $finish)", async ({ start, finish, count }) => {
    const directory = await mkdtemp(join(tmpdir(), "vaani-consent-test-"));
    try {
      const { service, settings } = createDictationService();
      makeSettingsMutable(settings, { ...DEFAULT_SETTINGS, saveRecordings: start, recordingsPath: directory });
      service.beginHotkeySession();
      const sessionId = (service.getState() as { sessionId: string }).sessionId;
      service.reportRecorderStarted(sessionId);
      settings.update({ saveRecordings: finish, recordingsPath: join(directory, "changed") });
      service.endHotkeySession();
      await service.submitAudioClip({ sessionId, clip: { pcmData: new Array(16000).fill(0.1), sampleRate: 16000, durationSeconds: 1, rmsFrames: [0.1] } });
      const files = await readdir(directory);
      expect(files).toHaveLength(count);
      expect(files.every((name) => name.endsWith(".wav"))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("passes the same start-time route through STT and formatting despite settings edits", async () => {
    const fixture = createInsertionRecovery("snapshot-session");
    const { service, settings, transcription } = createDictationService({ recovery: fixture.recovery, recoveryReady: () => true });
    makeSettingsMutable(settings, { ...DEFAULT_SETTINGS, transcriptionProvider: "groq", language: "hi", groqApiKey: "secret-canary" });
    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    settings.update({ language: "en", transcriptionProvider: "openai", customPrompt: "new prompt" });
    service.endHotkeySession();
    await service.submitAudioClip({ sessionId, clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] } });
    const snapshot = fixture.getEntry().settingsSnapshot;
    expect(snapshot).toMatchObject({ language: "hi", transcriptionProvider: "groq", customPrompt: "" });
    expect(JSON.stringify(snapshot)).not.toContain("secret-canary");
    expect(transcription.transcribe).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sessionSettings: snapshot, languageOverride: "hi" }));
    expect(transcription.formatTranscript).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ sessionSettings: snapshot }));
  });

  it("refuses legacy recovery formatting without a recorded route", async () => {
    const fixture = createInsertionRecovery("legacy");
    delete fixture.getEntry().settingsSnapshot;
    fixture.getEntry().state = "recoverable";
    fixture.getEntry().text.rawTranscript = "old text";
    const { service, transcription } = createDictationService({ recovery: fixture.recovery, recoveryReady: () => true });
    await expect(service.retryRecoveryFormatting("legacy")).resolves.toBe(false);
    expect(transcription.formatTranscript).not.toHaveBeenCalled();
    expect(fixture.recovery.transition).not.toHaveBeenCalled();
  });

  it("does not retain an earlier recording when consent is enabled mid-session", async () => {
    const fixture = createInsertionRecovery("no-consent");
    const recoveryAudio = {
      spool: vi.fn(async () => ({ mode: "full" as const, audio: { kind: "encrypted-session-file" as const, path: "/managed/audio.enc" } })),
      deleteForSession: vi.fn(async () => undefined),
      withDecryptedAudio: async <T>(_id: string, _operation: (path: string) => Promise<T> | T): Promise<T> => { throw new Error("unused"); },
    };
    const { service, settings } = createDictationService({ recovery: fixture.recovery, recoveryAudio, recoveryReady: () => true });
    makeSettingsMutable(settings);
    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    settings.update({ retainFailedAudio: true });
    service.handleRecorderFailure({ sessionId, message: "failed" }, { pcmData: [0.1], sampleRate: 16000, durationSeconds: 1, rmsFrames: [0.1] });
    await service.flushRecovery();
    expect(recoveryAudio.spool).not.toHaveBeenCalled();
  });

  it("removes newly spooled audio if retention is revoked while the write is pending", async () => {
    const fixture = createInsertionRecovery("revoked");
    let finish: () => void = () => undefined;
    const recoveryAudio = {
      spool: vi.fn(() => new Promise<{ mode: "full"; audio: NonNullable<RecoveryEntry["audio"]> }>((resolve) => {
        finish = () => resolve({ mode: "full", audio: { kind: "encrypted-session-file", path: "/managed/audio.enc" } });
      })),
      deleteForSession: vi.fn(async () => undefined),
      withDecryptedAudio: async <T>(_id: string, _operation: (path: string) => Promise<T> | T): Promise<T> => { throw new Error("unused"); },
    };
    const { service, settings } = createDictationService({ recovery: fixture.recovery, recoveryAudio, recoveryReady: () => true });
    makeSettingsMutable(settings, { ...DEFAULT_SETTINGS, retainFailedAudio: true });
    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.handleRecorderFailure({ sessionId, message: "failed" }, { pcmData: [0.1], sampleRate: 16000, durationSeconds: 1, rmsFrames: [0.1] });
    await vi.waitFor(() => expect(recoveryAudio.spool).toHaveBeenCalledOnce());
    settings.update({ retainFailedAudio: false });
    finish();
    await service.flushRecovery();
    expect(recoveryAudio.deleteForSession).toHaveBeenCalledWith(sessionId);
  });

  it("selects formatted recovery text before cleaned and raw text", () => {
    expect(selectRecoveryText({ rawTranscript: "raw", cleanedText: "cleaned", formattedText: "formatted" })).toBe("formatted");
    expect(selectRecoveryText({ rawTranscript: "raw", cleanedText: "cleaned", formattedText: null })).toBe("cleaned");
    expect(selectRecoveryText({ rawTranscript: "raw", cleanedText: null, formattedText: null })).toBe("raw");
  });

  it("aborts recovery formatting when a new dictation starts and does not store the late result", async () => {
    const recoveryFixture = createInsertionRecovery("recovery-formatting");
    const current = recoveryFixture.getEntry();
    current.state = "recoverable";
    current.text.rawTranscript = "raw recovery text";
    let resolveFormat: (value: string) => void = () => undefined;
    const deferredFormat = new Promise<string>((resolve) => { resolveFormat = resolve; });
    const { service, transcription } = createDictationService({ recovery: recoveryFixture.recovery, recoveryReady: () => true });
    transcription.formatTranscript.mockReturnValueOnce(deferredFormat);

    const retry = service.retryRecoveryFormatting("recovery-formatting");
    for (let index = 0; index < 10 && recoveryFixture.recovery.transition.mock.calls.length < 1; index += 1) await Promise.resolve();
    service.cancelSession();
    resolveFormat("late formatted text");
    await expect(retry).resolves.toBe(false);
    expect(recoveryFixture.getEntry().text.formattedText).toBeNull();
  });

  it("applies the saved dictionary and cleanup settings on recovery formatting retry", async () => {
    const fixture = createInsertionRecovery("format-cleanup");
    const entry = fixture.getEntry();
    entry.state = "recoverable";
    entry.text.rawTranscript = "open get hub um";
    entry.settingsSnapshot = captureSessionSettings({
      ...DEFAULT_SETTINGS,
      customCorrections: [{ spoken: "get hub", written: "GitHub", source: "auto-suggested" }],
    });
    const { service, transcription } = createDictationService({ recovery: fixture.recovery, recoveryReady: () => true });

    await expect(service.retryRecoveryFormatting(entry.id)).resolves.toBe(true);

    expect(transcription.formatTranscript).toHaveBeenCalledWith("open GitHub um", expect.anything());
    expect(fixture.getEntry().text).toMatchObject({ formattedText: "open GitHub um", cleanedText: "Open GitHub." });
  });

  it("revalidates recovery insertion before the injector and leaves one retryable outcome", async () => {
    const recoveryFixture = createInsertionRecovery("recovery-insertion");
    const current = recoveryFixture.getEntry();
    current.state = "text_ready";
    current.text = { rawTranscript: "raw", cleanedText: "cleaned", formattedText: "formatted" };
    const { service, injector } = createDictationService({ recovery: recoveryFixture.recovery, recoveryReady: () => true });

    const retry = service.retryRecoveryInsertion("recovery-insertion");
    await Promise.resolve();
    service.cancelSession();
    await expect(retry).resolves.toBe(false);
    expect(recoveryFixture.getEntry().insertion?.outcome).not.toBe("delivered");
    await expect(service.retryRecoveryInsertion("recovery-insertion")).resolves.toBe(false);
    expect(injector.inject).not.toHaveBeenCalled();
  });

  it("does not refuse a recovery retry that a new dictation superseded while loading the entry", async () => {
    const fixture = createInsertionRecovery("superseded-retry");
    const entry = fixture.getEntry();
    entry.state = "text_ready";
    entry.text.cleanedText = "...";
    const loadEntry = fixture.recovery.getById;
    let finishLoad: () => void = () => undefined;
    const loadFinished = new Promise<void>((resolve) => { finishLoad = resolve; });
    const recovery = { ...fixture.recovery, getById: vi.fn(async () => { const loaded = await loadEntry(); await loadFinished; return loaded; }) };
    const { service, injector } = createDictationService({ recovery, recoveryReady: () => true });

    const retry = service.retryRecoveryInsertion(entry.id);
    service.beginHotkeySession();
    await Promise.resolve();
    const before = service.getState();
    finishLoad();

    await expect(retry).resolves.toBe(false);
    expect(service.getState()).toEqual(before);
    expect(injector.inject).not.toHaveBeenCalled();
  });

  it("refuses manual recovery retry when its focused identity disappears", async () => {
    const fixture = createInsertionRecovery("manual-identity-lost");
    const entry = fixture.getEntry();
    entry.state = "text_ready";
    entry.text.cleanedText = "Hello world.";
    const identity = vi.fn().mockReturnValueOnce("field-a").mockReturnValue(null);
    const { service, injector } = createDictationService({ recovery: fixture.recovery, recoveryReady: () => true, focusedIdentity: identity });

    await expect(service.retryRecoveryInsertion(entry.id)).resolves.toBe(false);

    expect(injector.inject).not.toHaveBeenCalled();
    expect(fixture.getEntry().insertion?.outcome).toBe("recoverable");
    expect(service.getState()).toMatchObject({ status: "error", message: "Not inserted: target changed." });
  });

  it("refuses manual recovery retry when the initial focused identity is unknown", async () => {
    const fixture = createInsertionRecovery("manual-identity-unknown");
    const entry = fixture.getEntry();
    entry.state = "text_ready";
    entry.text.cleanedText = "Hello world.";
    const { service, injector } = createDictationService({ recovery: fixture.recovery, recoveryReady: () => true, focusedIdentity: () => null });

    await expect(service.retryRecoveryInsertion(entry.id)).resolves.toBe(false);

    expect(injector.inject).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({ status: "error", message: "Not inserted: target changed." });
  });

  it("attempts manual recovery insertion with stable identity and null AX value", async () => {
    const fixture = createInsertionRecovery("manual-weak-ax");
    const entry = fixture.getEntry();
    entry.state = "text_ready";
    entry.text.cleanedText = "Hello world.";
    const { service, injector } = createDictationService({ recovery: fixture.recovery, recoveryReady: () => true });
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = () => null;

    await expect(service.retryRecoveryInsertion(entry.id)).resolves.toBe(false);

    expect(injector.inject).toHaveBeenCalledOnce();
    expect(fixture.getEntry().insertion?.outcome).toBe("recoverable");
  });

  it("refuses manual recovery dispatch when readable AX value changes during injection preparation", async () => {
    const fixture = createInsertionRecovery("manual-value-changed");
    const entry = fixture.getEntry();
    entry.state = "text_ready";
    entry.text.cleanedText = "Hello world.";
    const { service, injector } = createDictationService({ recovery: fixture.recovery, recoveryReady: () => true });
    let value = "";
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = () => value;
    injector.inject.mockImplementationOnce(async (_text, _target, options) => {
      value = "different content";
      return options?.isTargetValid?.() ? { success: true, method: "clipboard" } : { success: false, reason: "target_changed" };
    });

    await expect(service.retryRecoveryInsertion(entry.id)).resolves.toBe(false);

    expect(injector.inject).toHaveBeenCalledOnce();
    expect(fixture.getEntry().insertion?.outcome).toBe("recoverable");
    expect(service.getState()).toMatchObject({ status: "error", message: "Not inserted: target changed." });
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("shows the pressed capsule and asks the recorder to start on hotkey down", () => {
    const { service, overlay, recorder } = createDictationService();

    service.beginHotkeySession();

    expect(overlay.setPressed).toHaveBeenCalledTimes(1);
    expect(overlay.setRecording).not.toHaveBeenCalled();
    expect(recorder.startRecording).toHaveBeenCalledTimes(1);
  });

  it("queues recording while the recorder warms up and errors only after timeout", () => {
    const { service, overlay, recorder } = createDictationService();
    recorder.isReady.mockReturnValue(false);

    service.beginHotkeySession();

    expect(overlay.setPressed).toHaveBeenCalledTimes(1);
    expect(recorder.startRecording).toHaveBeenCalledTimes(1);
    expect(overlay.setError).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000);

    expect(overlay.setError).toHaveBeenCalledTimes(1);
  });

  it("stays starting, with no recording indicator, until the recorder reports the first frame", () => {
    const { service, overlay } = createDictationService();

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    vi.advanceTimersByTime(4_000);

    expect(service.getState()).toMatchObject({ status: "starting", sessionId });
    expect(overlay.setRecording).not.toHaveBeenCalled();

    service.reportRecorderStarted(sessionId);

    expect(service.getState()).toMatchObject({ status: "recording", sessionId });
    expect(overlay.setRecording).toHaveBeenCalledTimes(1);
  });

  it("releases the recorder and errors when no frame arrives before the start deadline", () => {
    const { service, overlay, recorder } = createDictationService();

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    vi.advanceTimersByTime(5_000);

    expect(recorder.abortRecording).toHaveBeenCalledWith(sessionId);
    expect(overlay.setRecording).not.toHaveBeenCalled();
    expect(overlay.setError).toHaveBeenCalledTimes(1);
  });

  it("scales the demo transcription timeout for long clips", async () => {
    const { service, transcription } = createDictationService();
    transcription.transcribe.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve({ rawText: "long result", formattedText: "long result", language: "en" }), 45_000);
    }));

    const result = service.demoTranscribe({
      pcmData: new Array(181).fill(0.1),
      sampleRate: 1,
      durationSeconds: 181,
      rmsFrames: [0.1],
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(result).resolves.toBe("long result");
  });

  it("keeps the original 30-second timeout for a single-chunk clip", async () => {
    const { service, transcription } = createDictationService();
    transcription.transcribe.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve({ rawText: "late result", formattedText: "late result", language: "en" }), 31_000);
    }));

    const result = service.demoTranscribe({
      pcmData: [0.1],
      sampleRate: 16_000,
      durationSeconds: 1,
      rmsFrames: [0.1],
    });
    const timedOut = expect(result).rejects.toThrow("Transcription timed out. Please try again.");
    await vi.advanceTimersByTimeAsync(30_000);

    await timedOut;
    await vi.advanceTimersByTimeAsync(1_000);
  });

  it("forwards audio bars while recording", () => {
    const { service, overlay, mainWindow } = createDictationService();

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    const frame: AudioVisualFrame = { level: 0.42, bars: [0.1, 0.4, 0.7] };
    service.updateAudioLevel(frame);

    expect(overlay.updateBars).toHaveBeenCalledWith(frame.bars);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(IpcChannel.AudioLevel, frame.level, frame.bars);
  });

  it("enters processing on release and still hides on cancel", () => {
    const { service, overlay, recorder } = createDictationService();

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();

    expect(overlay.setProcessing).toHaveBeenCalledTimes(1);
    expect(recorder.stopRecording).toHaveBeenCalledWith(sessionId);

    service.cancelSession();

    expect(overlay.hide).toHaveBeenCalledTimes(1);
  });

  it("ignores paste latest while a recording is in flight", async () => {
    const { service, history } = createDictationService();

    service.beginHotkeySession();
    await service.pasteLatestEntry();

    expect(history.getLatest).not.toHaveBeenCalled();
  });

  it("shows a real error when the recorder reports start failure", () => {
    const { service, overlay } = createDictationService();

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.handleRecorderFailure({ sessionId, message: "Microphone permission denied." });

    expect(overlay.setError).toHaveBeenCalledTimes(1);
  });

  it("keeps the specific hotkey failure message during an active session", async () => {
    const traceDeps = createTraceDeps();
    const { service } = createDictationService({ traces: traceDeps.traces });
    const message = "Microphone permission denied.";

    service.beginHotkeySession();
    service.reportHotkeyUnavailable(message);

    expect(service.getState()).toMatchObject({ status: "error", message });
    await vi.waitFor(() => expect(traceDeps.getTrace()).toMatchObject({ outcome: "failed", rejectionReason: "recorder_unavailable", userMessage: message }));
  });

  it("errors if recording starts but no real audio frames arrive", () => {
    const { service, overlay, recorder } = createDictationService();

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    vi.advanceTimersByTime(1_600);

    expect(recorder.stopRecording).toHaveBeenCalledWith(sessionId);
    expect(overlay.setError).toHaveBeenCalledTimes(1);
  });

  it("rejects digitally silent audio with a microphone permission failure when access is not granted", async () => {
    const traceDeps = createTraceDeps();
    const { service } = createDictationService({
      traces: traceDeps.traces,
      getMicrophonePermission: () => "denied",
    });
    const permissionMessage = "Microphone access is not granted. Enable it in System Settings > Privacy & Security > Microphone, then restart Vaani.";

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0] }
    });

    expect(service.getState()).toMatchObject({ status: "error", message: permissionMessage });
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "rejected", rejectionReason: "microphone_permission_denied", userMessage: permissionMessage });
  });

  it("keeps digitally silent audio on the no-speech path when microphone access is granted", async () => {
    const traceDeps = createTraceDeps();
    const { service } = createDictationService({
      traces: traceDeps.traces,
      getMicrophonePermission: () => "granted",
    });
    const noSpeechMessage = "No speech detected. Try speaking louder or closer to the microphone.";

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0] }
    });

    expect(service.getState()).toMatchObject({ status: "error", message: noSpeechMessage });
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "rejected", rejectionReason: "no_speech", userMessage: noSpeechMessage, speechGate: { decision: "silent" } });
  });

  it("sends a valid-length quiet clip to transcription and inserts the text", async () => {
    const traceDeps = createTraceDeps();
    const { service, transcription, injector } = createDictationService({ traces: traceDeps.traces });

    await submitClip(service, steadyClip(0.004));

    expect(transcription.transcribe).toHaveBeenCalledOnce();
    expect(injector.inject).toHaveBeenCalledOnce();
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "verified", speechGate: { pass: true, decision: "speech", reason: "speech-dominant" } });
  });

  it("sends nonzero audio with no speech contrast to transcription as uncertain", async () => {
    const traceDeps = createTraceDeps();
    const { service, transcription, injector } = createDictationService({ traces: traceDeps.traces });

    await submitClip(service, steadyClip(0.0005));

    expect(transcription.transcribe).toHaveBeenCalledOnce();
    expect(injector.inject).toHaveBeenCalledOnce();
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "verified", speechGate: { pass: true, decision: "uncertain", reason: "no-speech-contrast" } });
  });

  it("rejects an empty clip before transcription", async () => {
    const traceDeps = createTraceDeps();
    const { service, transcription } = createDictationService({ traces: traceDeps.traces });

    await submitClip(service, { pcmData: [], sampleRate: 16_000, durationSeconds: 0, rmsFrames: [] });

    expect(transcription.transcribe).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({ status: "error", message: "No speech detected. Try speaking louder or closer to the microphone." });
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "rejected", rejectionReason: "no_speech", speechGate: { decision: "silent" } });
  });

  it("keeps quiet but nonzero audio on the no-speech path when microphone access is not granted", async () => {
    const traceDeps = createTraceDeps();
    const { service } = createDictationService({
      traces: traceDeps.traces,
      getMicrophonePermission: () => "denied",
    });
    const permissionMessage = "Microphone access is not granted. Enable it in System Settings > Privacy & Security > Microphone, then restart Vaani.";

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.000001), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.000001] }
    });

    expect(service.getState()).toMatchObject({ status: "error", message: permissionMessage });
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "rejected", rejectionReason: "microphone_permission_denied", userMessage: permissionMessage });
  });

  it("maps transcription deadline errors to a timeout failure", async () => {
    const traceDeps = createTraceDeps();
    const { service, transcription } = createDictationService({ traces: traceDeps.traces });
    transcription.transcribe.mockRejectedValue(new TranscriptionDeadlineExceededError());

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });
    await Promise.resolve();

    expect(service.getState()).toMatchObject({ status: "error", message: "Transcription timed out. Please try again." });
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "failed", rejectionReason: "timeout", userMessage: "Transcription timed out. Please try again." });
  });

  it("formatter deadline still inserts corrected text", async () => {
    const traceDeps = createTraceDeps();
    const { service, settings, history, injector, transcription } = createDictationService({ traces: traceDeps.traces });
    makeSettingsMutable(settings, {
      ...DEFAULT_SETTINGS,
      customCorrections: [{ spoken: "get hub", written: "GitHub", source: "auto-suggested" }],
    });
    transcription.formatTranscript.mockRejectedValue(new TranscriptionDeadlineExceededError());

    await submitHelloWorld(service);
    await Promise.resolve();

    expect(injector.inject).toHaveBeenCalledWith("Open GitHub.", expect.anything(), expect.anything());
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ cleanedText: "Open GitHub.", injectionStatus: "injected" }));
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "verified", userMessage: "Inserted. Formatting did not apply. Inserted the unformatted text.", stages: { formatterUsed: "none", formatterReason: "timeout" } });
  });

  it("forces the formatter deadline only with the development switch", async () => {
    vi.stubEnv("VAANI_DEV_FORCE_FORMAT_TIMEOUT", "1");
    const traceDeps = createTraceDeps();
    const { service, transcription, injector } = createDictationService({ traces: traceDeps.traces });

    await submitHelloWorld(service);
    await Promise.resolve();

    expect(transcription.formatTranscript).not.toHaveBeenCalled();
    expect(injector.inject).toHaveBeenCalled();
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "verified", stages: { formatterUsed: "none", formatterReason: "timeout" } });
  });

  it("stale guard finishes trace with the stuck stage and a visible message", async () => {
    const traceDeps = createTraceDeps();
    const { service, transcription, injector, overlay } = createDictationService({ traces: traceDeps.traces });
    let resolveTranscription: ((result: TranscriptionResult) => void) | undefined;
    transcription.transcribe.mockImplementation(() => new Promise((resolve) => { resolveTranscription = resolve; }));

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    const submission = service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.getState().status).toBe("transcribing");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.getState()).toMatchObject({ status: "error", message: "Dictation stopped while transcribing. Please try again." });
    expect(overlay.setError).toHaveBeenCalled();
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "failed", rejectionReason: "stale-session", stages: { staleStage: "transcribing", outcome: "failed" }, completedAt: expect.any(String) });

    resolveTranscription?.({ rawText: "late text", formattedText: "late text", language: "en" });
    await submission;
    expect(injector.inject).not.toHaveBeenCalled();
  });

  it("settles a stale session as unconfirmed after paste dispatch and preserves History", async () => {
    const traceDeps = createTraceDeps();
    const { service, injector, history } = createDictationService({ traces: traceDeps.traces });
    let finishInjection: (result: InjectionResult) => void = () => undefined;
    injector.inject.mockImplementationOnce((_text, _target, options) => {
      options?.onDispatch?.();
      return new Promise<InjectionResult>((resolve) => { finishInjection = resolve; });
    });
    const submission = submitHelloWorld(service);
    await vi.advanceTimersByTimeAsync(0);
    expect(injector.inject).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    finishInjection({ success: true, method: "clipboard" });
    await submission;
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ cleanedText: "Open get hub.", injectionStatus: "saved" }));
    expect(traceDeps.getTrace()?.outcome).toBe("unconfirmed");
  });

  it("keeps unrelated transcription failures classified as transcription errors", async () => {
    const traceDeps = createTraceDeps();
    const { service, transcription } = createDictationService({ traces: traceDeps.traces });
    transcription.transcribe.mockRejectedValue(new Error("Provider unavailable."));

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });
    await Promise.resolve();

    expect(service.getState()).toMatchObject({ status: "error", message: "Provider unavailable." });
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "failed", rejectionReason: "transcription_error", userMessage: "Provider unavailable." });
  });

  it("does not inject one-letter no-speech hallucinations", async () => {
    const { service, history, injector, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "l", formattedText: "l", language: "en" });

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    expect(injector.inject).not.toHaveBeenCalled();
    expect(history.append).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({ status: "error", message: "I only caught a fragment. Please try again." });
  });

  it("preserves first and last words through formatting, cleanup, and injection", async () => {
    const { service, history, injector, transcription } = createDictationService();
    const rawText = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const cleanedText = "Alpha beta gamma delta epsilon zeta eta theta iota kappa.";
    transcription.transcribe.mockResolvedValue({ rawText, formattedText: rawText, language: "en" });
    transcription.formatTranscript.mockResolvedValue(rawText);

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    expect(injector.inject).toHaveBeenCalledWith(cleanedText, expect.anything(), expect.objectContaining({ isTargetValid: expect.any(Function) }));
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({
      rawText,
      cleanedText,
      injectionStatus: "injected",
    }));
  });

  it("keeps repeated words and stores the raw transcript apart from the inserted text", async () => {
    const { service, history, injector, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "i had had enough", formattedText: "i had had enough", language: "en" });

    await submitHelloWorld(service);

    expect(injector.inject).toHaveBeenCalledWith("I had had enough.", expect.anything(), expect.objectContaining({ isTargetValid: expect.any(Function) }));
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({
      rawText: "i had had enough",
      cleanedText: "I had had enough.",
    }));
  });

  it("refuses to insert text that cleanup reduces to punctuation", async () => {
    const { service, injector, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "um uh um uh", formattedText: "um uh um uh", language: "en" });

    await submitHelloWorld(service);

    expect(injector.inject).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({ status: "error", message: "Nothing to insert. The transcript was empty after cleanup." });
  });

  it("refuses to reinject a history entry that is punctuation only", async () => {
    const { service, history, injector } = createDictationService();
    history.getById.mockResolvedValue({ id: "entry-1", cleanedText: "...", rawText: "um" });
    injector.inject.mockClear();

    await service.reinjectEntry("entry-1");

    expect(injector.inject).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({ status: "error", message: "Nothing to insert. The transcript was empty after cleanup." });
  });

  it("refuses to paste latest when the latest entry is punctuation only", async () => {
    const { service, history, injector } = createDictationService();
    history.getLatest.mockResolvedValue({ id: "entry-1", cleanedText: ".", rawText: "um" });

    await service.pasteLatestEntry();

    expect(injector.inject).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({ status: "error", message: "Nothing to insert. The transcript was empty after cleanup." });
  });

  it("records stage timestamps from hotkey release through insertion verification", async () => {
    const traceDeps = createTraceDeps();
    const { service } = createDictationService({ traces: traceDeps.traces });
    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] },
      tailMetrics: { lastFrameAfterStopMs: 320, trailingRms: 0.02 },
    });
    await vi.waitFor(() => expect(traceDeps.getTrace()?.completedAt).toBeDefined());
    const trace = traceDeps.getTrace();
    expect(trace).toMatchObject({
      stopRequestedAt: expect.any(String),
      lastFrameAfterStopMs: 320,
      trailingRms: 0.02,
      clipReadyAt: expect.any(String),
      sttDoneAt: expect.any(String),
      formatDoneAt: expect.any(String),
      dispatchAt: expect.any(String),
      verifyDoneAt: expect.any(String),
      outcome: "verified",
    });
    expect(trace?.stopRequestedAt).toBe(trace?.hotkeyReleasedAt);
  });

  it("records the build, capture settings, pre-gain levels, and speech gate on the trace", async () => {
    const traceDeps = createTraceDeps();
    const { service } = createDictationService({ traces: traceDeps.traces });
    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.025], gain: 4 },
      captureSettings: { echoCancellation: true, autoGainControl: true, noiseSuppression: false },
    });
    await vi.waitFor(() => expect(traceDeps.getTrace()?.completedAt).toBeDefined());
    const trace = traceDeps.getTrace();
    expect(trace?.buildIdentifier).toMatch(/^1\.1\.3\+/);
    expect(trace?.captureSettings).toEqual({ echoCancellation: true, autoGainControl: true, noiseSuppression: false });
    expect(trace?.rawAudio?.peakAmplitude).toBeCloseTo(0.1);
    expect(trace?.captureLevels?.gain).toBe(4);
    expect(trace?.captureLevels?.preGainPeak).toBeCloseTo(0.025);
    expect(trace?.captureLevels?.preGainRms).toBeCloseTo(0.025);
    expect(trace?.speechGate).toMatchObject({ pass: true, decision: "speech", reason: "speech-dominant" });
  });

  it("records each segment's no-speech value from the transcription provider", async () => {
    const traceDeps = createTraceDeps();
    const { service, settings, transcription } = createDictationService({ traces: traceDeps.traces });
    makeSettingsMutable(settings, { ...DEFAULT_SETTINGS, transcriptionProvider: "groq" });
    transcription.transcribe.mockResolvedValueOnce({
      rawText: "open get hub",
      formattedText: "open get hub",
      language: "en",
      quality: {
        provider: "groq",
        attemptCount: 1,
        supportsConfidence: true,
        noSpeechProbability: 0.2,
        transcriptLength: 13,
        segmentNoSpeechProbabilities: [0.1, 0.2],
      },
    });
    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] },
    });
    await vi.waitFor(() => expect(traceDeps.getTrace()?.completedAt).toBeDefined());
    expect(traceDeps.getTrace()?.quality?.segmentNoSpeechProbabilities).toEqual([0.1, 0.2]);
  });

  it("keeps the original release time when stop waits for recorder startup", async () => {
    const traceDeps = createTraceDeps();
    const { service } = createDictationService({ traces: traceDeps.traces });
    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.endHotkeySession();
    await vi.waitFor(() => expect(traceDeps.getTrace()?.stopRequestedAt).toBeDefined());
    const release = traceDeps.getTrace()?.stopRequestedAt;
    vi.setSystemTime(new Date("2026-09-26T12:00:02.000Z"));
    service.reportRecorderStarted(sessionId);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(traceDeps.getTrace()?.stopRequestedAt).toBe(release);
  });

  it("uses the effective app language and surfaces provider detection", async () => {
    const { service, history, overlay, settings, transcription } = createDictationService();
    makeSettingsMutable(settings, {
      ...DEFAULT_SETTINGS,
      language: "hi",
      appProfiles: [{ id: "text-edit", name: "TextEdit", appBundleIds: ["com.apple.TextEdit"], language: "auto" }],
    });
    transcription.transcribe.mockImplementation(async (...args) => {
      const options = args[1] as { languageOverride?: string } | undefined;
      expect(options).toMatchObject({ languageOverride: "hi" });
      return { rawText: "namaste world", formattedText: "namaste world", language: null, detectedLanguage: "hi" };
    });

    await submitHelloWorld(service);

    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ detectedLanguage: "hi" }));
    expect(overlay.setSuccess).toHaveBeenCalledWith("hi");
  });

  it("uses cleaned raw transcript when content guard rejects LLM formatting", async () => {
    let trace: DictationTrace | null = null;
    const traces = {
      upsert: vi.fn(async (next: DictationTrace) => { trace = next; }),
      updateById: vi.fn(async (_id: string, updater: (current: DictationTrace) => DictationTrace) => {
        if (!trace) throw new Error("Trace was not initialized.");
        trace = updater(trace);
        return trace;
      }),
      getById: vi.fn(async () => trace ?? undefined),
      getBySessionId: vi.fn(async () => trace ?? undefined),
    };
    const { service, history, injector, transcription } = createDictationService({ traces });
    transcription.transcribe.mockResolvedValue({ rawText: "um I like this", formattedText: "um I like this", language: "en" });
    Object.assign(transcription, {
      formatTranscriptDetailed: vi.fn(async () => ({
        text: "um I like this",
        formatterUsed: "guard-fallback",
        formatterStatus: "rejected",
        formatterStatusReason: "The formatter changed words in the transcript.",
        contentGuardVerdict: { passed: false, missingWords: ["like"] },
      })),
    });

    service.beginHotkeySession();
    await Promise.resolve();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });
    await Promise.resolve();

    expect(injector.inject).toHaveBeenCalledWith("I like this.", expect.anything(), expect.objectContaining({ isTargetValid: expect.any(Function) }));
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({
      rawText: "um I like this",
      formattedText: "um I like this",
      cleanedText: "I like this.",
    }));
    const updatedTrace = trace as DictationTrace | null;
    expect(updatedTrace?.stages).toMatchObject({
      cleanedText: "I like this.",
      formatterUsed: "guard-fallback",
      formatterStatus: "rejected",
      formatterStatusReason: "The formatter changed words in the transcript.",
      contentGuardVerdict: { passed: false, missingWords: ["like"] },
    });
    expect(["1.1.3+unresolved", "unresolved+unresolved"]).toContain(updatedTrace?.buildIdentifier);
  });

  it("inserts the literal text and warns when the formatter drops a word", async () => {
    groqCreate.mockResolvedValue({ choices: [{ message: { content: "Please send the report." } }] });
    const traceDeps = createTraceDeps();
    const { service, injector, transcription, settings } = createDictationService({ traces: traceDeps.traces });
    settings.get.mockReturnValue({ ...DEFAULT_SETTINGS, formattingProvider: "groq-llm", groqApiKey: "groq-key" });
    const formatter = new TranscriptionService(() => ({ ...DEFAULT_SETTINGS, formattingProvider: "groq-llm", groqApiKey: "groq-key" }));
    Object.assign(transcription, { formatTranscriptDetailed: formatter.formatTranscriptDetailed.bind(formatter) });
    transcription.transcribe.mockResolvedValue({ rawText: "please send the report today", formattedText: "please send the report today", language: "en" });

    service.beginHotkeySession();
    await Promise.resolve();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });
    await Promise.resolve();

    expect(injector.inject).toHaveBeenCalledWith("Please send the report today.", expect.anything(), expect.anything());
    expect(service.getState()).toMatchObject({
      status: "completed",
      message: "Inserted. Formatting did not apply. Inserted the unformatted text.",
    });
    expect(traceDeps.getTrace()).toMatchObject({
      stages: { formatterUsed: "none", formatterStatus: "rejected", formatterStatusReason: "The formatter changed words in the transcript." },
    });
  });

  it("says formatting applied only in part when some paragraphs kept formatter output", async () => {
    const { service, injector, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "please send the report today", formattedText: "please send the report today", language: "en" });
    Object.assign(transcription, {
      formatTranscriptDetailed: vi.fn(async () => ({
        text: "Please send the report.\n\nthen call them today",
        formatterUsed: "none",
        formatterStatus: "failed",
        formatterStatusReason: "Formatter problem.",
        partiallyFormatted: true,
      })),
    });

    await submitHelloWorld(service);

    expect(injector.inject).toHaveBeenCalledOnce();
    expect(service.getState()).toMatchObject({
      status: "completed",
      message: "Inserted. Formatting applied only in part. Some text was inserted unformatted.",
    });
  });

  it("warns when formatting is skipped because the formatter has no API key", async () => {
    const { service, transcription, settings } = createDictationService();
    settings.get.mockReturnValue({ ...DEFAULT_SETTINGS, formattingProvider: "groq-llm" });
    const formatter = new TranscriptionService(() => ({ ...DEFAULT_SETTINGS, formattingProvider: "groq-llm" }));
    Object.assign(transcription, { formatTranscriptDetailed: formatter.formatTranscriptDetailed.bind(formatter) });
    transcription.transcribe.mockResolvedValue({ rawText: "please send the report today", formattedText: "please send the report today", language: "en" });

    await submitHelloWorld(service);

    expect(groqCreate).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({
      status: "completed",
      message: "Inserted. Formatting did not apply. Inserted the unformatted text.",
    });
  });

  it("does not warn when formatting is skipped for a transcript too short to format", async () => {
    const { service, transcription, settings } = createDictationService();
    settings.get.mockReturnValue({ ...DEFAULT_SETTINGS, formattingProvider: "groq-llm", groqApiKey: "groq-key" });
    const formatter = new TranscriptionService(() => ({ ...DEFAULT_SETTINGS, formattingProvider: "groq-llm", groqApiKey: "groq-key" }));
    Object.assign(transcription, { formatTranscriptDetailed: formatter.formatTranscriptDetailed.bind(formatter) });
    transcription.transcribe.mockResolvedValue({ rawText: "hello there", formattedText: "hello there", language: "en" });

    await submitHelloWorld(service);

    expect(groqCreate).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({ status: "completed", message: "Inserted." });
  });

  it("saves no-speech hallucinations when quality retries are exhausted", async () => {
    const { service, history, injector, transcription } = createDictationService();
    const suspiciousResult: TranscriptionResult = {
      rawText: "thank you",
      formattedText: "thank you",
      language: "en",
      quality: {
        provider: "groq",
        attemptCount: 1,
        supportsConfidence: true,
        noSpeechProbability: 0.95,
        transcriptLength: 9,
      },
    };
    transcription.transcribe.mockResolvedValue(suspiciousResult);

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    expect(injector.inject).not.toHaveBeenCalled();
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({
      rawText: "thank you",
      cleanedText: "Thank you.",
      injectionStatus: "saved",
      injectionMethod: null,
    }));
    expect(service.getState()).toMatchObject({ status: "completed", outcome: "saved", insertionOutcome: "failed", message: "Transcript quality failed. Find this session in History." });
  });

  it("prepares insertion before injection and saves a failed active request without copying", async () => {
    const recoveryFixture = createInsertionRecovery("session-1");
    const { service, transcription, injector, history } = createDictationService({
      recovery: recoveryFixture.recovery,
      recoveryReady: () => true,
      copyText: () => true,
    });
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    injector.inject.mockResolvedValue({ success: false, reason: "insertion_failed" });

    await submitHelloWorld(service);

    const prepareOrder = recoveryFixture.recovery.prepareInsertion.mock.invocationCallOrder[0];
    const outcomeOrder = recoveryFixture.recovery.recordInsertionOutcome.mock.invocationCallOrder[0];
    if (prepareOrder === undefined || outcomeOrder === undefined) throw new Error("Insertion recovery calls were not recorded.");
    expect(prepareOrder).toBeLessThan(outcomeOrder);
    expect(recoveryFixture.getEntry().insertion).toMatchObject({
      outcome: "recoverable",
      baselineReadable: true,
      intendedStrategy: "ax",
      textHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved" }));
    expect(service.getState()).toMatchObject({ status: "completed", insertionOutcome: "failed", message: "Insertion failed. Find this session in History." });
  });

  it("revalidates focused element identity after awaited preparation", async () => {
    const recoveryFixture = createInsertionRecovery("identity-session");
    const { service, history, injector } = createDictationService({ recovery: recoveryFixture.recovery, recoveryReady: () => true });
    const identity = nativeBridge as { getFocusedElementIdentity?: ReturnType<typeof vi.fn> };
    identity.getFocusedElementIdentity = vi.fn()
      .mockReturnValueOnce("field-a")
      .mockReturnValueOnce("field-a")
      .mockReturnValue("field-b");
    recoveryFixture.recovery.prepareInsertion.mockImplementationOnce(async () => {
      await Promise.resolve();
      return recoveryFixture.getEntry();
    });

    await submitHelloWorld(service);

    expect(injector.inject).not.toHaveBeenCalled();
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved" }));
  });

  it("refuses automatic insertion when focused identity is unavailable", async () => {
    const traceDeps = createTraceDeps();
    const { service, history, injector } = createDictationService({ traces: traceDeps.traces });
    (nativeBridge as { getFocusedElementIdentity?: () => string | null }).getFocusedElementIdentity = vi.fn(() => null);

    await submitHelloWorld(service);

    expect(injector.inject).not.toHaveBeenCalled();
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved" }));
    expect(service.getState()).toMatchObject({ insertionOutcome: "refused", message: "Not inserted: target changed." });
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "refused" });
  });

  it("refuses automatic insertion when a known identity disappears before dispatch", async () => {
    const { service, history, injector } = createDictationService({ focusedIdentity: vi.fn()
      .mockReturnValueOnce("field-a")
      .mockReturnValueOnce("field-a")
      .mockReturnValue(null) });

    await submitHelloWorld(service);

    expect(injector.inject).not.toHaveBeenCalled();
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved" }));
    expect(service.getState()).toMatchObject({ insertionOutcome: "refused", message: "Not inserted: target changed." });
  });

  it("dispatches with stable identity and null AX value, then records unconfirmed", async () => {
    const { service, injector, history } = createDictationService();
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = () => null;

    await submitHelloWorld(service);

    expect(injector.inject).toHaveBeenCalledOnce();
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved" }));
    expect(service.getState()).toMatchObject({ insertionOutcome: "unconfirmed" });
  });

  it("refuses when AX value changes before the final automatic read", async () => {
    const fixture = createInsertionRecovery("value-change");
    const { service, injector } = createDictationService({ recovery: fixture.recovery, recoveryReady: () => true });
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValue("changed field");

    await submitHelloWorld(service);

    expect(injector.inject).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({ insertionOutcome: "refused" });
  });

  it("refuses automatic dispatch when readable AX value changes during injection preparation", async () => {
    const { service, injector } = createDictationService();
    let value = "";
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = () => value;
    injector.inject.mockImplementationOnce(async (_text, _target, options) => {
      value = "different content";
      return options?.isTargetValid?.() ? { success: true, method: "clipboard" } : { success: false, reason: "target_changed" };
    });

    await submitHelloWorld(service);

    expect(injector.inject).toHaveBeenCalledOnce();
    expect(service.getState()).toMatchObject({ insertionOutcome: "refused", message: "Not inserted: target changed." });
  });

  it.skipIf(!existsSync(join(process.cwd(), "build/Release/vaani_native.node")))("exposes a focused identity export from the built addon", () => {
    const addon: unknown = createRequire(import.meta.url)(join(process.cwd(), "build/Release/vaani_native.node"));
    if (!addon || typeof addon !== "object" || !("getFocusedElementIdentity" in addon)
      || typeof addon.getFocusedElementIdentity !== "function") throw new Error("Native focused identity export is missing.");
    // The test runner has no Accessibility trust, so the value itself is null here.
    const identity: unknown = addon.getFocusedElementIdentity();
    expect(identity === null || typeof identity === "string").toBe(true);
  });

  it("creates recoverable insertion when clipboard fallback fails", async () => {
    const recoveryFixture = createInsertionRecovery("session-1");
    const { service, transcription, injector } = createDictationService({
      recovery: recoveryFixture.recovery,
      recoveryReady: () => true,
      copyText: () => false,
    });
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    injector.inject.mockResolvedValue({ success: true, method: "clipboard" });
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn(() => "");

    await submitHelloWorld(service);

    expect(recoveryFixture.getEntry().insertion).toMatchObject({ outcome: "recoverable", status: "failed" });
    expect(service.getState()).toMatchObject({ status: "completed", insertionOutcome: "unconfirmed", message: "Insertion unconfirmed. Check the field before pasting again." });
  });

  it("fences transcription and insertion while lifecycle audio retention is stalled", async () => {
    const recoveryFixture = createInsertionRecovery("lifecycle-session");
    let releaseSpool: ((result: { mode: "full"; audio: NonNullable<RecoveryEntry["audio"]> }) => void) | null = null;
    const recoveryAudio = {
      spool: vi.fn(() => new Promise<{ mode: "full"; audio: NonNullable<RecoveryEntry["audio"]> }>((resolve) => {
        releaseSpool = resolve;
      })),
      deleteForSession: vi.fn(async () => undefined),
      withDecryptedAudio: async <T>(_sessionId: string, _operation: (path: string) => Promise<T> | T): Promise<T> => {
        throw new Error("not used in lifecycle fence test");
      },
    };
    const { service, settings, transcription } = createDictationService({
      recovery: recoveryFixture.recovery,
      recoveryAudio,
      recoveryReady: () => true,
    });
    makeSettingsMutable(settings, { ...DEFAULT_SETTINGS, retainFailedAudio: true });
    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    const clip: AudioClip = { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] };

    const interruption = service.handleLifecycleInterruption(sessionId, 1, "sleep", "interrupted", clip);
    await vi.waitFor(() => expect(recoveryAudio.spool).toHaveBeenCalledTimes(1));
    await service.submitAudioClip({ sessionId, clip });
    expect(transcription.transcribe).not.toHaveBeenCalled();

    releaseSpool!({ mode: "full", audio: { kind: "encrypted-session-file", path: "/managed/lifecycle-session.v1.enc" } });
    await interruption;
    expect(transcription.transcribe).not.toHaveBeenCalled();
  });

  it("waits for stalled recovery audio retention during flush", async () => {
    const recoveryFixture = createInsertionRecovery("flush-session");
    let releaseSpool: (() => void) | null = null;
    const recoveryAudio = {
      spool: vi.fn(() => new Promise<{ mode: "full"; audio: NonNullable<RecoveryEntry["audio"]> }>((resolve) => {
        releaseSpool = () => resolve({ mode: "full", audio: { kind: "encrypted-session-file", path: "/managed/flush-session.v1.enc" } });
      })),
      deleteForSession: vi.fn(async () => undefined),
      withDecryptedAudio: async <T>(_sessionId: string, _operation: (path: string) => Promise<T> | T): Promise<T> => {
        throw new Error("not used in flush fence test");
      },
    };
    const { service, settings } = createDictationService({ recovery: recoveryFixture.recovery, recoveryAudio, recoveryReady: () => true });
    makeSettingsMutable(settings, { ...DEFAULT_SETTINGS, retainFailedAudio: true });
    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.handleRecorderFailure({ sessionId, message: "recorder failed" }, {
      pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1],
    });
    await vi.waitFor(() => expect(recoveryAudio.spool).toHaveBeenCalledTimes(1));

    let flushed = false;
    const flush = service.flushRecovery().then(() => { flushed = true; });
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    expect(flushed).toBe(false);
    releaseSpool!();
    await flush;
    expect(flushed).toBe(true);
  });

  it("records verified recovery delivery after cancellation between verification and journal commit", async () => {
    const recoveryFixture = createInsertionRecovery("recovery-session");
    const entry = recoveryFixture.getEntry();
    entry.state = "text_ready";
    entry.text.cleanedText = "Hello world.";
    entry.text.formattedText = "Hello world.";
    const { service, injector } = createDictationService({ recovery: recoveryFixture.recovery, recoveryReady: () => true });
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValue("Hello world.");
    injector.inject.mockResolvedValue({ success: true, method: "clipboard" });
    let getByIdCount = 0;
    recoveryFixture.recovery.getById.mockImplementation(async () => {
      getByIdCount += 1;
      if (getByIdCount === 5) service.cancelSession();
      return recoveryFixture.getEntry();
    });

    const result = await service.retryRecoveryInsertion(entry.id);

    expect(result).toBe(true);
    expect(injector.inject).toHaveBeenCalledWith("Hello world.", expect.anything(), expect.objectContaining({ isTargetValid: expect.any(Function) }));
    expect(recoveryFixture.recovery.recordInsertionOutcome).toHaveBeenCalledWith(
      entry.id,
      entry.sessionId,
      "delivered",
      expect.objectContaining({ method: "clipboard" }),
    );
    expect(recoveryFixture.getEntry().terminal).toBe("delivered");
  });

  it("refuses to copy punctuation-only recovery text without changing a live dictation", async () => {
    const entry = { ...createRecoveryEntry({ id: "entry-1", sessionId: "session-1", buildIdentifier: "1.0.0+abc1234" }), state: "text_ready" as const, text: { rawTranscript: "um", cleanedText: "...", formattedText: null } };
    const recovery = { ...createInsertionRecovery("session-1").recovery, getById: vi.fn(async () => entry) };
    const copyText = vi.fn(async () => true);
    const { service } = createDictationService({ recovery, recoveryReady: () => true, copyText });

    service.beginHotkeySession();
    const liveState = service.getState();
    await expect(service.copyRecoveryEntry("entry-1")).resolves.toBe(false);
    expect(service.getState()).toEqual(liveState);
    expect(copyText).not.toHaveBeenCalled();
  });

  it("shows the empty-text error when an idle recovery copy is refused", async () => {
    const entry = { ...createRecoveryEntry({ id: "entry-1", sessionId: "session-1", buildIdentifier: "1.0.0+abc1234" }), state: "text_ready" as const, text: { rawTranscript: "um", cleanedText: "...", formattedText: null } };
    const recovery = { ...createInsertionRecovery("session-1").recovery, getById: vi.fn(async () => entry) };
    const { service, injector } = createDictationService({ recovery, recoveryReady: () => true });

    await expect(service.copyRecoveryEntry("entry-1")).resolves.toBe(false);
    expect(service.getState()).toMatchObject({ status: "error", message: "Nothing to insert. The transcript was empty after cleanup." });
    expect(injector.inject).not.toHaveBeenCalled();
  });

  it("rejects recovery insertion while a fresh dictation is active", async () => {
    const recoveryFixture = createInsertionRecovery("session-1");
    const { service } = createDictationService({ recovery: recoveryFixture.recovery, recoveryReady: () => true });

    service.beginHotkeySession();
    await expect(service.retryRecoveryInsertion("session-1")).resolves.toBe(false);
    expect(recoveryFixture.recovery.getById).not.toHaveBeenCalled();
  });

  it("does not retry a terminal recovery outcome", async () => {
    const recoveryFixture = createInsertionRecovery("session-1");
    const { service, injector } = createDictationService({ recovery: recoveryFixture.recovery, recoveryReady: () => true });
    const current = recoveryFixture.getEntry();
    current.state = "copied";
    current.terminal = "copied";
    current.insertion = { status: "failed", outcome: "copied", method: "clipboard" };

    await expect(service.retryRecoveryInsertion("session-1")).resolves.toBe(false);
    expect(injector.inject).not.toHaveBeenCalled();
  });

  it("refuses recovery retry after an uncertain prior insertion", async () => {
    const recoveryFixture = createInsertionRecovery("uncertain-retry");
    const current = recoveryFixture.getEntry();
    current.state = "recoverable";
    current.text.cleanedText = "Hello world.";
    current.insertion = { status: "failed", outcome: "recoverable", detail: "outcome_uncertain" };
    const { service, injector } = createDictationService({ recovery: recoveryFixture.recovery, recoveryReady: () => true });

    await expect(service.retryRecoveryInsertion(current.id)).resolves.toBe(false);
    expect(injector.inject).not.toHaveBeenCalled();
    expect(recoveryFixture.recovery.prepareInsertion).not.toHaveBeenCalled();
  });

  it("closes a cancelled recovery retry after dispatch and refuses another attempt", async () => {
    const recoveryFixture = createInsertionRecovery("cancelled-retry");
    const current = recoveryFixture.getEntry();
    current.state = "text_ready";
    current.text.cleanedText = "Hello world.";
    const { service, injector } = createDictationService({ recovery: recoveryFixture.recovery, recoveryReady: () => true });
    let finishInjection: (result: InjectionResult) => void = () => undefined;
    injector.inject.mockImplementationOnce((_text, _target, options) => {
      options?.onDispatch?.();
      return new Promise<InjectionResult>((resolve) => { finishInjection = resolve; });
    });

    const retry = service.retryRecoveryInsertion(current.id);
    await vi.waitFor(() => expect(injector.inject).toHaveBeenCalledTimes(1));
    service.cancelSession();
    finishInjection({ success: false, reason: "outcome_uncertain" });
    await expect(retry).resolves.toBe(false);

    expect(recoveryFixture.getEntry().insertion).toMatchObject({ status: "failed", outcome: "recoverable", detail: "outcome_uncertain" });
    await expect(service.retryRecoveryInsertion(current.id)).resolves.toBe(false);
    await expect(service.retryRecoveryInsertion(current.id)).resolves.toBe(false);
    expect(injector.inject).toHaveBeenCalledTimes(1);
  });

  it("records an uncertain recovery outcome when cancelled after dispatch", async () => {
    const recoveryFixture = createInsertionRecovery("session-1");
    const traceDeps = createTraceDeps();
    const { service, injector } = createDictationService({ recovery: recoveryFixture.recovery, recoveryReady: () => true, traces: traceDeps.traces });
    let finishInjection: (result: InjectionResult) => void = () => undefined;
    injector.inject.mockImplementationOnce((_text, _target, options) => {
      options?.onDispatch?.();
      return new Promise<InjectionResult>((resolve) => { finishInjection = resolve; });
    });

    const submission = submitHelloWorld(service);
    await vi.waitFor(() => expect(injector.inject).toHaveBeenCalledTimes(1));
    service.cancelSession();
    finishInjection({ success: false, reason: "outcome_uncertain" });
    await submission;
    await service.flushRecovery();

    expect(recoveryFixture.getEntry().insertion).toMatchObject({ status: "failed", outcome: "recoverable", detail: "outcome_uncertain" });
    await vi.waitFor(() => expect(traceDeps.getTrace()).toMatchObject({ outcome: "unconfirmed", completedAt: expect.any(String) }));
    await expect(service.retryRecoveryInsertion("session-1")).resolves.toBe(false);
    expect(injector.inject).toHaveBeenCalledTimes(1);
  });

  it("sends short non-silent clips to transcription untrimmed", async () => {
    const { service, transcription } = createDictationService();
    const clip = {
      pcmData: [
        ...new Array(320).fill(0),
        ...new Array(16_000).fill(0.1),
        ...new Array(320).fill(0),
      ],
      sampleRate: 16_000,
      durationSeconds: 1.04,
      rmsFrames: [0, ...new Array(50).fill(0.1), 0],
    };

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({ sessionId, clip });

    expect(transcription.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: clip.durationSeconds, pcmData: clip.pcmData }),
      expect.objectContaining({ speechContext: { trimmedDurationSeconds: clip.durationSeconds, speechGatePassed: true } }),
    );
  });

  it("sends long non-silent clips to transcription untrimmed while keeping VAD metrics", async () => {
    let trace: DictationTrace | null = null;
    const traces = {
      upsert: vi.fn(async (next: DictationTrace) => { trace = next; }),
      updateById: vi.fn(async (_id: string, updater: (current: DictationTrace) => DictationTrace) => {
        if (!trace) throw new Error("Trace was not initialized.");
        trace = updater(trace);
        return trace;
      }),
      getById: vi.fn(async () => trace ?? undefined),
      getBySessionId: vi.fn(async () => trace ?? undefined),
    };
    const { service, transcription } = createDictationService({ traces });
    const clip = {
      pcmData: [
        ...new Array(16_000).fill(0),
        ...new Array(480_000).fill(0.1),
      ],
      sampleRate: 16_000,
      durationSeconds: 31,
      rmsFrames: [0, ...new Array(1_500).fill(0.1)],
    };

    service.beginHotkeySession();
    await Promise.resolve();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({ sessionId, clip });

    expect(transcription.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: clip.durationSeconds, pcmData: clip.pcmData }),
      expect.objectContaining({ speechContext: { trimmedDurationSeconds: expect.any(Number), speechGatePassed: true } }),
    );
    const updatedTrace = trace as DictationTrace | null;
    expect(updatedTrace?.rawAudio?.durationSeconds).toBe(31);
    expect(updatedTrace?.trimmedAudio?.durationSeconds).toBeLessThan(31);
    expect(transcription.transcribe.mock.calls[0]?.[1]?.speechContext?.trimmedDurationSeconds).toBe(updatedTrace?.trimmedAudio?.durationSeconds);
  });

  it("saves when an existing identical occurrence is unchanged after injection", async () => {
    const traceDeps = createTraceDeps();
    const { service, history, injector, transcription } = createDictationService({ traces: traceDeps.traces });
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    injector.inject.mockResolvedValue({ success: true, method: "clipboard" });
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn(() => "Hello world.");

    await submitHelloWorld(service);
    await Promise.resolve();

    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved", injectionMethod: null }));
    expect(traceDeps.getTrace()?.stages?.insertionVerification).toMatchObject({ passed: false, reason: "timeout" });
  });

  it("passes when insertion increases an existing occurrence count", async () => {
    const { service, history, injector, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    injector.inject.mockResolvedValue({ success: true, method: "clipboard" });
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn()
      .mockReturnValueOnce("Hello world.")
      .mockReturnValueOnce("Hello world.")
      .mockReturnValueOnce("Hello world.")
      .mockReturnValue("Hello world. Hello world.");

    await submitHelloWorld(service);

    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "injected", injectionMethod: "clipboard" }));
  });

  it("passes when insertion increases the occurrence count from zero to one", async () => {
    const { service, history, injector, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    injector.inject.mockResolvedValue({ success: true, method: "clipboard" });
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValue("Hello world.");

    await submitHelloWorld(service);

    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "injected", injectionMethod: "clipboard" }));
  });

  it("does not pass when unrelated field changes leave the occurrence count unchanged", async () => {
    const { service, history, injector, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    injector.inject.mockResolvedValue({ success: true, method: "clipboard" });
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn()
      .mockReturnValueOnce("Hello world. old")
      .mockReturnValueOnce("Hello world. old")
      .mockReturnValue("Hello world. new");

    await submitHelloWorld(service);

    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved", injectionMethod: null }));
  });

  it("records a distinct failure when the pre-insertion baseline is unreadable", async () => {
    const traceDeps = createTraceDeps();
    const { service, history, injector, transcription, verifierTime } = createDictationService({ traces: traceDeps.traces });
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    injector.inject.mockResolvedValue({ success: true, method: "clipboard" });
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValue(null);

    await submitHelloWorld(service);
    await Promise.resolve();

    expect(verifierTime()).toBe(0);
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved", injectionMethod: null }));
    expect(traceDeps.getTrace()?.stages?.insertionVerification).toEqual({
      readable: false,
      passed: false,
      repaired: false,
      reason: "baseline-unreadable",
    });
  });

  it("does not verify a pinned target from another app's baseline after focus drift", async () => {
    const traceDeps = createTraceDeps();
    const { service, history, injector, transcription, appDetector } = createDictationService({ traces: traceDeps.traces });
    const primaryTarget = { appBundleId: "com.apple.TextEdit", appName: "TextEdit", context: "default" as const };
    const driftedTarget = { appBundleId: "com.apple.Notes", appName: "Notes", context: "default" as const };
    let focusedTarget = primaryTarget;
    appDetector.getContext.mockImplementation(() => focusedTarget);
    transcription.transcribe.mockImplementation(async () => {
      focusedTarget = driftedTarget;
      return { rawText: "hello world", formattedText: "hello world", language: "en" };
    });
    injector.inject.mockImplementation(async () => {
      focusedTarget = primaryTarget;
      return { success: true, method: "clipboard" };
    });
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn(() => (
      focusedTarget === driftedTarget ? "" : "Hello world."
    ));

    await submitHelloWorld(service);
    await Promise.resolve();

    expect(injector.inject).not.toHaveBeenCalled();
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved", injectionMethod: null }));
    expect(traceDeps.getTrace()?.stages?.insertionVerification).toEqual({
      readable: false,
      passed: false,
      repaired: false,
      reason: "not-at-target",
    });
  });

  it("does not fall back to a newly foregrounded app when primary insertion fails", async () => {
    const traceDeps = createTraceDeps();
    const { service, history, injector, transcription, appDetector } = createDictationService({ traces: traceDeps.traces });
    const primaryTarget = { appBundleId: "com.apple.TextEdit", appName: "TextEdit", context: "default" as const };
    const otherTarget = { appBundleId: "com.apple.Notes", appName: "Notes", context: "default" as const };
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    appDetector.getContext
      .mockReturnValueOnce(primaryTarget)
      .mockReturnValueOnce(primaryTarget)
      .mockReturnValueOnce(primaryTarget)
      .mockReturnValueOnce(primaryTarget)
      .mockReturnValue(otherTarget);
    injector.inject.mockResolvedValueOnce({ success: false, reason: "insertion_failed" });

    await submitHelloWorld(service);
    await Promise.resolve();

    expect(injector.inject).toHaveBeenCalledTimes(1);
    expect(injector.inject).not.toHaveBeenCalledWith("Hello world.", expect.objectContaining({ appBundleId: otherTarget.appBundleId }), expect.anything());
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved", injectionMethod: null }));
    expect(traceDeps.getTrace()?.injectionAttempts).toHaveLength(1);
  });

  it("passes the session signal and a focused-target guard to the injector", async () => {
    const { service, injector, transcription, appDetector } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    let options: { signal?: AbortSignal; isTargetValid?: () => boolean } | undefined;
    injector.inject.mockImplementationOnce(async (...args: unknown[]) => {
      options = args[2] as typeof options;
      return { success: false, reason: "cancelled" };
    });

    await submitHelloWorld(service);
    await Promise.resolve();

    expect(options?.signal).toBeInstanceOf(AbortSignal);
    appDetector.getContext.mockReturnValue({ appBundleId: "com.apple.Notes", appName: "Notes", context: "default" as const });
    expect(options?.isTargetValid?.()).toBe(false);
  });

  it("does not re-insert when the injector reports an uncertain outcome", async () => {
    const copyText = vi.fn(async () => true);
    const traceDeps = createTraceDeps();
    const { service, history, injector, transcription, overlay } = createDictationService({ copyText, traces: traceDeps.traces });
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    injector.inject.mockResolvedValueOnce({ success: false, reason: "outcome_uncertain" });

    await submitHelloWorld(service);
    await Promise.resolve();

    expect(injector.inject).toHaveBeenCalledTimes(1);
    expect(copyText).not.toHaveBeenCalled();
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved", injectionMethod: null }));
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "unconfirmed", userMessage: "Insertion unconfirmed. Check the field before pasting again." });
    expect(service.getState()).toMatchObject({ insertionOutcome: "unconfirmed" });
    expect(overlay.setStatusMessage).toHaveBeenCalledWith("Insertion unconfirmed. Check the field before pasting again. Find this session in History.");
  });

  it("refuses a changed target without copying its text", async () => {
    const traceDeps = createTraceDeps();
    const copyText = vi.fn(async () => true);
    const { service, injector, appDetector } = createDictationService({ traces: traceDeps.traces, copyText });
    const originalTarget = { appBundleId: "com.apple.TextEdit", appName: "TextEdit", context: "default" as const };
    const changedTarget = { appBundleId: "com.apple.Notes", appName: "Notes", context: "default" as const };
    appDetector.getContext.mockReturnValueOnce(originalTarget).mockReturnValue(changedTarget);

    await submitHelloWorld(service);

    expect(injector.inject).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "refused", userMessage: "Not inserted: target changed." });
    expect(service.getState()).toMatchObject({ status: "completed", insertionOutcome: "refused", text: "Open get hub.", message: "Not inserted: target changed." });
  });

  it("does not retry a failed insertion into a newly focused app", async () => {
    const { service, injector, appDetector, history } = createDictationService();
    injector.inject.mockImplementationOnce(async () => {
      appDetector.getContext.mockReturnValue({ appBundleId: "com.apple.Notes", appName: "Notes", context: "default" });
      return { success: false, reason: "insertion_failed" };
    });
    await submitHelloWorld(service);
    expect(injector.inject).toHaveBeenCalledOnce();
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved" }));
  });

  it("refuses automatic insertion when the same app bundle has a different process ID", async () => {
    const { service, injector, appDetector, history } = createDictationService();
    let reads = 0;
    appDetector.getContext.mockImplementation(() => ({
      appBundleId: "com.apple.Notes", appName: "Notes", context: "default", pid: ++reads === 1 ? 101 : 202,
    }));
    await submitHelloWorld(service);
    expect(injector.inject).not.toHaveBeenCalled();
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved" }));
  });

  it("copies without dispatch in copy-only mode", async () => {
    const traceDeps = createTraceDeps();
    const copyText = vi.fn(async () => true);
    const { service, settings, injector, history } = createDictationService({ traces: traceDeps.traces, copyText });
    makeSettingsMutable(settings, { ...DEFAULT_SETTINGS, injectionMode: "clipboard" });

    await submitHelloWorld(service);

    expect(injector.inject).not.toHaveBeenCalled();
    expect(copyText).toHaveBeenCalledWith("Open get hub.");
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved" }));
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "copy-only", userMessage: "Copied. Paste when ready." });
    expect(service.getState()).toMatchObject({ status: "completed", insertionOutcome: "copy-only", message: "Copied. Paste when ready." });
  });

  it("never says Saved when History rejects a verified insertion", async () => {
    const traceDeps = createTraceDeps();
    const { service, history, injector } = createDictationService({ traces: traceDeps.traces });
    history.append.mockRejectedValueOnce(new Error("disk full"));

    await submitHelloWorld(service);

    expect(injector.inject).toHaveBeenCalledOnce();
    expect(traceDeps.getTrace()).toMatchObject({ outcome: "verified", userMessage: "Inserted." });
    expect(service.getState()).toMatchObject({ insertionOutcome: "verified", message: "Inserted." });
    expect(JSON.stringify(service.getState())).not.toContain("Saved");
  });

  it("names the History failure without claiming a clipboard copy", async () => {
    const traceDeps = createTraceDeps();
    const copyText = vi.fn(async () => true);
    const { service, history, injector } = createDictationService({ traces: traceDeps.traces, copyText });
    injector.inject.mockResolvedValueOnce({ success: false, reason: "insertion_failed" });
    history.append.mockRejectedValueOnce(new Error("disk full"));

    await submitHelloWorld(service);

    expect(traceDeps.getTrace()).toMatchObject({ outcome: "failed", userMessage: "History failed. Text was not saved." });
    expect(service.getState()).toMatchObject({ outcome: "failed", insertionOutcome: "failed", message: "History failed. Text was not saved." });
    expect(JSON.stringify(service.getState())).not.toContain("Saved");
  });

  it("fails closed when the focused field changes within the same app", async () => {
    const { service, history, injector, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    (nativeBridge as { getFocusedSelection?: () => { location: number; length: number } | null }).getFocusedSelection = vi.fn()
      .mockReturnValueOnce({ location: 0, length: 0 })
      .mockReturnValue({ location: 12, length: 0 });

    await submitHelloWorld(service);

    expect(injector.inject).not.toHaveBeenCalled();
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ injectionStatus: "saved" }));
    expect(service.getState()).toMatchObject({ status: "completed", outcome: "saved" });
  });

  it("does not claim delivery for partial mutation at the verification deadline", async () => {
    const { service, history, injector, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    injector.inject.mockResolvedValue({ success: true, method: "clipboard" });
    let readCount = 0;
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn(() => {
      readCount += 1;
      if (readCount <= 3) return "";
      return "Hello";
    });

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    expect(injector.inject).toHaveBeenNthCalledWith(1, "Hello world.", expect.anything(), expect.objectContaining({ isTargetValid: expect.any(Function) }));
    expect(injector.inject).toHaveBeenCalledTimes(1);
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({
      injectionStatus: "saved",
      injectionMethod: null,
    }));
  });

  it("waits through delayed insertion completion without repairing the partial value", async () => {
    const { service, history, injector, transcription, verifierTime } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    let readCount = 0;
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn(() => {
      readCount += 1;
      if (readCount <= 3) return "";
      if (readCount <= 7) return "Hello";
      return "Hello world.";
    });

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    expect(injector.inject).toHaveBeenCalledTimes(1);
    expect(verifierTime()).toBeGreaterThan(180);
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({
      injectionStatus: "injected",
      injectionMethod: "clipboard",
    }));
    expect(service.getState()).toMatchObject({ status: "completed", outcome: "injected" });
  });

  it("saves to history when insertion verification is unreadable", async () => {
    let trace: DictationTrace | null = null;
    const traces = {
      upsert: vi.fn(async (next: DictationTrace) => { trace = next; }),
      updateById: vi.fn(async (_id: string, updater: (current: DictationTrace) => DictationTrace) => {
        if (!trace) throw new Error("Trace was not initialized.");
        trace = updater(trace);
        return trace;
      }),
      getById: vi.fn(async () => trace ?? undefined),
      getBySessionId: vi.fn(async () => trace ?? undefined),
    };
    const { service, history, transcription, injector, verifierTime } = createDictationService({ traces });
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce(null);

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });
    await Promise.resolve();

    expect(injector.inject).toHaveBeenCalledTimes(1);
    expect(verifierTime()).toBe(2_000);
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({
      cleanedText: "Hello world.",
      injectionStatus: "saved",
      injectionMethod: null,
    }));
    const updatedTrace = trace as DictationTrace | null;
    expect(updatedTrace?.stages?.insertionVerification).toMatchObject({
      readable: false,
      passed: false,
      repaired: false,
      reason: "timeout",
    });
    expect(service.getState()).toMatchObject({ status: "completed", outcome: "saved", insertionOutcome: "unconfirmed", message: "Insertion unconfirmed. Check the field before pasting again." });
  });

  it("bug report export excludes content canaries and preserves diagnostic metadata", async () => {
    const contentCanaries = [
      "ENTRY_RAW_CANARY",
      "ENTRY_FORMATTED_CANARY",
      "ENTRY_CLEANED_CANARY",
      "ENTRY_TARGET_BUNDLE_CANARY",
      "ENTRY_TARGET_NAME_CANARY",
      "ENTRY_AUDIO_PATH_CANARY",
      "TRACE_TARGET_BUNDLE_CANARY",
      "TRACE_TARGET_NAME_CANARY",
      "TRACE_AUDIO_PATH_CANARY",
      "TRACE_USER_MESSAGE_CANARY",
      "TRACE_DECISION_REASON_CANARY",
      "QUALITY_DECISION_REASON_CANARY",
      "PROVIDER_ERROR_CANARY",
      "PROVIDER_DECISION_REASON_CANARY",
      "INJECTION_TARGET_BUNDLE_CANARY",
      "INJECTION_TARGET_NAME_CANARY",
      "INJECTION_FIELD_CANARY",
      "INJECTION_FALLBACK_CANARY",
      "STAGE_RAW_CANARY",
      "STAGE_DECISION_REASON_CANARY",
      "STAGE_CLEANED_CANARY",
      "STAGE_CORRECTION_SPOKEN_CANARY",
      "STAGE_CORRECTION_WRITTEN_CANARY",
      "STAGE_MISSING_WORD_CANARY",
      "STAGE_INJECTED_CANARY",
      "UNEXPECTED_TRACE_CANARY",
      "UNEXPECTED_ENTRY_CANARY",
    ];
    const trace: DictationTrace & { unexpectedContent: string } = {
      id: "trace-1",
      sessionId: "session-1",
      startedAt: "2026-06-29T00:00:00.000Z",
      completedAt: "2026-06-29T00:00:02.000Z",
      buildIdentifier: "1.2.3+build.4",
      targetAppBundleId: "TRACE_TARGET_BUNDLE_CANARY",
      targetAppName: "TRACE_TARGET_NAME_CANARY",
      outcome: "saved",
      rejectionReason: "insertion_failed",
      rawAudioPath: "/private/TRACE_AUDIO_PATH_CANARY/raw.wav",
      sttProvider: "groq",
      sttLatencyMs: 321,
      formattingLatencyMs: 45,
      transcriptLength: 27,
      injectionMethod: "ax",
      rawAudio: {
        durationSeconds: 1.5,
        sampleRate: 16_000,
        sampleCount: 24_000,
        rmsAverage: 0.1,
        rmsPeak: 0.2,
        peakAmplitude: 0.3,
        clippingRatio: 0,
        silenceRatio: 0.15,
      },
      qualityDecision: { action: "save", reason: "TRACE_DECISION_REASON_CANARY" },
      quality: {
        provider: "groq",
        attemptCount: 1,
        supportsConfidence: true,
        confidence: 0.91,
        transcriptLength: 27,
        decision: { action: "save", reason: "QUALITY_DECISION_REASON_CANARY" },
      },
      providerAttempts: [{
        provider: "groq",
        success: false,
        attempt: 1,
        latencyMs: 300,
        error: "PROVIDER_ERROR_CANARY",
        outcome: "failed",
        errorClass: "timeout",
        quality: {
          provider: "groq",
          attemptCount: 1,
          supportsConfidence: false,
          transcriptLength: 0,
          decision: { action: "retry", reason: "PROVIDER_DECISION_REASON_CANARY" },
        },
      }],
      injectionAttempts: [{
        targetAppBundleId: "INJECTION_TARGET_BUNDLE_CANARY",
        targetAppName: "INJECTION_TARGET_NAME_CANARY",
        targetFieldClass: "INJECTION_FIELD_CANARY",
        method: "ax",
        success: false,
        fallbackReason: "INJECTION_FALLBACK_CANARY",
        verification: { readable: true, passed: false, repaired: false, reason: "missing" },
      }],
      stages: {
        rawTranscript: "STAGE_RAW_CANARY",
        qualityDecision: {
          action: "save",
          reason: "STAGE_DECISION_REASON_CANARY",
          confidence: 0.91,
          attemptCount: 1,
        },
        cleanedText: "STAGE_CLEANED_CANARY",
        formatterUsed: "deterministic",
        contentGuardVerdict: { passed: false, missingWords: ["STAGE_MISSING_WORD_CANARY"] },
        correctionsApplied: [{ spoken: "STAGE_CORRECTION_SPOKEN_CANARY", written: "STAGE_CORRECTION_WRITTEN_CANARY" }],
        injectedText: "STAGE_INJECTED_CANARY",
        injectionStrategy: "ax",
        insertionVerification: { readable: true, passed: false, repaired: false, reason: "missing" },
        outcome: "saved",
      },
      userMessage: "TRACE_USER_MESSAGE_CANARY",
      unexpectedContent: "UNEXPECTED_TRACE_CANARY",
    };
    const traces = {
      upsert: vi.fn(),
      updateById: vi.fn(),
      getById: vi.fn(async () => trace),
      getBySessionId: vi.fn(),
    };
    const { service, history } = createDictationService({ traces });
    const entry: DictationEntry & { unexpectedContent: string } = {
      id: "entry-1",
      traceId: "trace-1",
      timestamp: "2026-06-29T00:00:00.000Z",
      rawText: "ENTRY_RAW_CANARY",
      formattedText: "ENTRY_FORMATTED_CANARY",
      cleanedText: "ENTRY_CLEANED_CANARY",
      durationSeconds: 1.5,
      appBundleId: "ENTRY_TARGET_BUNDLE_CANARY",
      appName: "ENTRY_TARGET_NAME_CANARY",
      injectionStatus: "saved",
      injectionMethod: "ax",
      language: "en",
      detectedLanguage: "en",
      rawAudioPath: "/private/ENTRY_AUDIO_PATH_CANARY/raw.wav",
      unexpectedContent: "UNEXPECTED_ENTRY_CANARY",
    };
    history.getById.mockResolvedValue(entry);

    const report = await service.exportBugReport("entry-1", "1.2.3");
    const serialized = JSON.stringify(report);

    for (const canary of contentCanaries) expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain("rawAudioPath");
    expect(report).toMatchObject({
      entry: {
        id: "entry-1",
        traceId: "trace-1",
        timestamp: "2026-06-29T00:00:00.000Z",
        durationSeconds: 1.5,
        injectionStatus: "saved",
        injectionMethod: "ax",
        language: "en",
        detectedLanguage: "en",
      },
      trace: {
        id: "trace-1",
        sessionId: "session-1",
        buildIdentifier: "1.2.3+build.4",
        sttProvider: "groq",
        sttLatencyMs: 321,
        formattingLatencyMs: 45,
        transcriptLength: 27,
        rawAudio: { sampleRate: 16_000, sampleCount: 24_000, silenceRatio: 0.15 },
        qualityDecision: { action: "save" },
        quality: { provider: "groq", confidence: 0.91, decision: { action: "save" } },
        providerAttempts: [{ provider: "groq", success: false, errorClass: "timeout", quality: { decision: { action: "retry" } } }],
        injectionAttempts: [{ method: "ax", success: false, verification: { reason: "missing" } }],
        stages: {
          qualityDecision: { action: "save", confidence: 0.91, attemptCount: 1 },
          formatterUsed: "deterministic",
          contentGuardVerdict: { passed: false },
          injectionStrategy: "ax",
          insertionVerification: { reason: "missing" },
          outcome: "saved",
        },
        injectionMethod: "ax",
        outcome: "saved",
        rejectionReason: "insertion_failed",
      },
      appVersion: "1.2.3",
    });
  });

  it("prompts for a dictionary correction shortly after the user edits inserted text", async () => {
    const { service, overlay, history, settings } = createDictationService();
    const nativeBridge = await import("@main/nativeBridge");
    const getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("Open get hub.")
      .mockReturnValueOnce("Open get hub.")
      .mockReturnValue("Open GitHub.");
    (nativeBridge.nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = getFocusedValue;

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    vi.advanceTimersByTime(500);
    await Promise.resolve();

    // Debounce (1s) not elapsed yet — nothing shown or committed.
    expect(overlay.showDictionaryPrompt).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_500);
    await Promise.resolve();

    expect(history.append).toHaveBeenCalledTimes(1);
    expect(overlay.showDictionaryPrompt).toHaveBeenCalledWith("get hub", "GitHub", expect.any(Function));
    expect(settings.update).toHaveBeenCalledWith({
      customCorrections: [{ spoken: "get hub", written: "GitHub", source: "auto-suggested" }]
    });
  });

  it("keeps watching long enough for a delayed manual correction", async () => {
    const { service, overlay, settings, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({
      rawText: "the final word after the pause is Baani",
      formattedText: "the final word after the pause is Baani",
      language: "en"
    });
    const nativeBridge = await import("@main/nativeBridge");
    const inserted = "The final word after the pause is Baani.";
    const corrected = "The final word after the pause is Vaani.";
    const getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce(inserted)
      .mockReturnValue(inserted);
    (nativeBridge.nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = getFocusedValue;

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    vi.advanceTimersByTime(20_000);
    await Promise.resolve();
    expect(overlay.showDictionaryPrompt).not.toHaveBeenCalled();

    getFocusedValue.mockReturnValue(corrected);
    vi.advanceTimersByTime(1_500);
    await Promise.resolve();

    expect(overlay.showDictionaryPrompt).toHaveBeenCalledWith("Baani", "Vaani", expect.any(Function));
    expect(settings.update).toHaveBeenCalledWith({
      customCorrections: [{ spoken: "Baani", written: "Vaani", source: "auto-suggested" }]
    });
  });

  it("prompts for a delayed camel-case product name correction", async () => {
    const { service, overlay, settings, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({
      rawText: "I'm making a latex editor called writex",
      formattedText: "I'm making a LaTeX editor called WriteX.",
      language: "en"
    });
    transcription.formatTranscript.mockResolvedValue("I'm making a LaTeX editor called WriteX.");
    const nativeBridge = await import("@main/nativeBridge");
    const inserted = "I'm making a LaTeX editor called WriteX.";
    const corrected = "I'm making a LaTeX editor called WriteTex.";
    const getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce(inserted)
      .mockReturnValue(inserted);
    (nativeBridge.nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = getFocusedValue;

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    vi.advanceTimersByTime(5_000);
    await Promise.resolve();
    expect(overlay.showDictionaryPrompt).not.toHaveBeenCalled();

    getFocusedValue.mockReturnValue(corrected);
    vi.advanceTimersByTime(1_500);
    await Promise.resolve();

    expect(overlay.showDictionaryPrompt).toHaveBeenCalledWith("WriteX", "WriteTex", expect.any(Function));
    expect(settings.update).toHaveBeenCalledWith({
      customCorrections: [{ spoken: "WriteX", written: "WriteTex", source: "auto-suggested" }]
    });
  });

  it("can learn from edits even when insertion verification was unreadable", async () => {
    const { service, overlay, settings, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({
      rawText: "the final word after the pause is Baani",
      formattedText: "the final word after the pause is Baani",
      language: "en"
    });
    const nativeBridge = await import("@main/nativeBridge");
    const inserted = "The final word after the pause is Baani.";
    const corrected = "The final word after the pause is Vaani.";
    const getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(inserted)
      .mockReturnValue(inserted);
    (nativeBridge.nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = getFocusedValue;

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    vi.advanceTimersByTime(500);
    await Promise.resolve();
    getFocusedValue.mockReturnValue(corrected);
    vi.advanceTimersByTime(1_500);
    await Promise.resolve();

    expect(overlay.showDictionaryPrompt).toHaveBeenCalledWith("Baani", "Vaani", expect.any(Function));
    expect(settings.update).toHaveBeenCalledWith({
      customCorrections: [{ spoken: "Baani", written: "Vaani", source: "auto-suggested" }]
    });
  });

  it("prompts when the first readable field value is already corrected", async () => {
    const { service, overlay, settings, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({
      rawText: "the final word after the pause is Baani",
      formattedText: "the final word after the pause is Baani",
      language: "en"
    });
    const nativeBridge = await import("@main/nativeBridge");
    const corrected = "The final word after the pause is Vaani.";
    let readCount = 0;
    const getFocusedValue = vi.fn(() => {
      readCount += 1;
      if (readCount <= 44) return readCount <= 3 ? "" : null;
      return corrected;
    });
    (nativeBridge.nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = getFocusedValue;

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    vi.advanceTimersByTime(1_500);
    await Promise.resolve();

    expect(overlay.showDictionaryPrompt).toHaveBeenCalledWith("Baani", "Vaani", expect.any(Function));
    expect(settings.update).toHaveBeenCalledWith({
      customCorrections: [{ spoken: "Baani", written: "Vaani", source: "auto-suggested" }]
    });
  });

  it("ignores stale accepted dictionary responses from an older generation", async () => {
    const { service, overlay, settings } = createDictationService();
    const mutable = makeSettingsMutable(settings);
    let resolvePrompt: (accepted: boolean) => void = () => {
      throw new Error("Expected dictionary prompt resolver.");
    };
    overlay.showDictionaryPrompt.mockImplementation((_spoken: string, _written: string, resolve: (accepted: boolean) => void) => {
      resolvePrompt = resolve;
    });

    const pending = service.showDictionarySuggestions([{ spoken: "get hub", written: "GitHub" }]);

    expect(overlay.showDictionaryPrompt).toHaveBeenCalledWith("get hub", "GitHub", expect.any(Function));
    expect(mutable.current().customCorrections).toEqual([]);
    const respond = resolvePrompt;
    service.beginHotkeySession();
    respond(true);
    await pending;

    expect(mutable.current().customCorrections).toEqual([]);
  });

  it("does not add a dictionary correction when the prompt is skipped", async () => {
    const { service, overlay, settings } = createDictationService();
    const mutable = makeSettingsMutable(settings);
    overlay.showDictionaryPrompt.mockImplementation((_spoken: string, _written: string, resolve: (accepted: boolean) => void) => {
      resolve(false);
    });

    await service.showDictionarySuggestions([{ spoken: "Bani", written: "Vaani" }]);

    expect(overlay.showDictionaryPrompt).toHaveBeenCalledWith("Bani", "Vaani", expect.any(Function));
    expect(mutable.current().customCorrections).toEqual([]);
  });

  it("drops dictionary suggestions that fail the safety gate", async () => {
    const { service, overlay, settings } = createDictationService();

    await service.showDictionarySuggestions([{ spoken: "It", written: "1 It" }]);

    expect(overlay.showDictionaryPrompt).not.toHaveBeenCalled();
    expect(settings.update).not.toHaveBeenCalledWith(expect.objectContaining({ customCorrections: expect.any(Array) }));
  });

  it("drops ordinary word edits instead of adding them to the dictionary", async () => {
    const { service, overlay, settings } = createDictationService();

    await service.showDictionarySuggestions([{ spoken: "food", written: "good" }]);

    expect(overlay.showDictionaryPrompt).not.toHaveBeenCalled();
    expect(settings.update).not.toHaveBeenCalledWith(expect.objectContaining({ customCorrections: expect.any(Array) }));
  });

  it("discards a pending edit suggestion when the next dictation starts", async () => {
    const { service, overlay, settings } = createDictationService();
    const nativeBridge = await import("@main/nativeBridge");
    const getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("Open get hub.")
      .mockReturnValueOnce("Open get hub.")
      .mockReturnValue("Open GitHub.");
    (nativeBridge.nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = getFocusedValue;

    service.beginHotkeySession();
    let sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    vi.advanceTimersByTime(500);
    await Promise.resolve();

    service.beginHotkeySession();
    sessionId = (service.getState() as { sessionId: string }).sessionId;

    vi.advanceTimersByTime(2_000);
    await Promise.resolve();

    expect(sessionId).toBeTruthy();
    expect(overlay.showDictionaryPrompt).not.toHaveBeenCalled();
    expect(settings.update).not.toHaveBeenCalledWith(expect.objectContaining({ customCorrections: expect.any(Array) }));
  });

  it("purges auto-suggested corrections without removing manual rules", () => {
    const { service, settings } = createDictationService();
    settings.get.mockReturnValue({
      ...DEFAULT_SETTINGS,
      customCorrections: [
        { spoken: "get hub", written: "GitHub", source: "auto-suggested" },
        { spoken: "om kar", written: "Onkar", source: "manual" },
        { spoken: "vaani", written: "Vaani" },
      ],
    });

    service.purgeAutoSuggestedCorrections();

    expect(settings.update).toHaveBeenCalledWith({
      customCorrections: [
        { spoken: "om kar", written: "Onkar", source: "manual" },
        { spoken: "vaani", written: "Vaani" },
      ],
    });
  });

  it("prompts to save a snippet when the edited text is a phrase, not a word correction", async () => {
    const { service, overlay, settings, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "my email", formattedText: "my email", language: "en" });
    const nativeBridge = await import("@main/nativeBridge");
    (nativeBridge.nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("My email.")
      .mockReturnValueOnce("My email.")
      .mockReturnValue("onkarj012@gmail.com");

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    vi.advanceTimersByTime(3_000);
    await Promise.resolve();

    expect(overlay.showSnippetPrompt).toHaveBeenCalledWith("onkarj012gmailcom", expect.any(Function));
    expect(settings.update).toHaveBeenCalledWith({
      snippets: [{ trigger: "onkarj012gmailcom", content: "onkarj012@gmail.com" }]
    });
  });

  it("waits for editing to settle before prompting for a dictionary rule", async () => {
    const { service, overlay, settings, transcription } = createDictationService();
    // "versel" is a realistic Whisper mishear of "Vercel" (close edit distance)
    transcription.transcribe.mockResolvedValue({ rawText: "use versel", formattedText: "use versel", language: "en" });
    const nativeBridge = await import("@main/nativeBridge");
    const getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("Use versel.")
      .mockReturnValueOnce("Use versel.")
      .mockReturnValueOnce("Use Ve")
      .mockReturnValueOnce("Use Verc")
      .mockReturnValue("Use Vercel.");
    (nativeBridge.nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = getFocusedValue;

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    vi.advanceTimersByTime(500);
    await Promise.resolve();
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    vi.advanceTimersByTime(500);
    await Promise.resolve();

    expect(overlay.showDictionaryPrompt).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_000);
    await Promise.resolve();

    expect(settings.update).toHaveBeenCalledWith({
      customCorrections: [{ spoken: "versel", written: "Vercel", source: "auto-suggested" }]
    });
    expect(overlay.showDictionaryPrompt).toHaveBeenCalledWith("versel", "Vercel", expect.any(Function));
  });

  it("does not suggest snippets for ordinary phrase edits", async () => {
    const { service, overlay, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "sentence", formattedText: "sentence", language: "en" });
    const nativeBridge = await import("@main/nativeBridge");
    (nativeBridge.nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("Sentence.")
      .mockReturnValueOnce("Sentence.")
      .mockReturnValue("Sentence about the release notes.");

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    vi.advanceTimersByTime(3_000);
    await Promise.resolve();

    expect(overlay.showSnippetPrompt).not.toHaveBeenCalled();
  });

  it("does not treat punctuation-heavy prose as snippet content", async () => {
    const { service, overlay, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "sentence", formattedText: "sentence", language: "en" });
    const nativeBridge = await import("@main/nativeBridge");
    (nativeBridge.nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("Sentence.")
      .mockReturnValueOnce("Sentence.")
      .mockReturnValue("Sentence: review the API/auth flow.");

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    vi.advanceTimersByTime(3_000);
    await Promise.resolve();

    expect(overlay.showSnippetPrompt).not.toHaveBeenCalled();
  });
});
