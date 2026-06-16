import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { AudioClip, DictationEntry, TranscriptionResult } from "@shared/types";
import { DictationService } from "./dictation.fixture";

function clip(): AudioClip {
  return { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function createEntry(id: string): DictationEntry {
  return {
    id,
    timestamp: new Date(2026, 5, 16).toISOString(),
    rawText: "hello",
    formattedText: "hello",
    cleanedText: "hello",
    durationSeconds: 1,
    appBundleId: "com.apple.TextEdit",
    appName: "TextEdit",
    injectionStatus: "saved",
    injectionMethod: null,
    language: "en",
  };
}

function createService() {
  let nextSession = 0;
  const overlay = {
    setPressed: vi.fn(),
    setRecording: vi.fn(),
    setProcessing: vi.fn(),
    setSuccess: vi.fn(),
    setError: vi.fn(),
    hide: vi.fn(),
    updateBars: vi.fn(),
    showDictionaryPrompt: vi.fn(),
    showSnippetPrompt: vi.fn(),
  };
  const mainWindow = { webContents: { send: vi.fn() } };
  const settings = {
    get: vi.fn(() => DEFAULT_SETTINGS),
    update: vi.fn((patch) => ({ ...DEFAULT_SETTINGS, ...patch })),
  };
  const history = {
    append: vi.fn(),
    updateById: vi.fn(),
    getById: vi.fn(async () => createEntry("stored")),
    getLatest: vi.fn(async () => createEntry("latest")),
    clear: vi.fn(),
  };
  const recorder = {
    isReady: vi.fn(() => true),
    startRecording: vi.fn(() => true),
    stopRecording: vi.fn(() => true),
  };
  const transcription = {
    transcribe: vi.fn(async (): Promise<TranscriptionResult> => ({ rawText: "hello", formattedText: "hello", language: "en" })),
    formatTranscript: vi.fn(async (text: string) => text),
  };
  const injector = {
    inject: vi.fn(async () => ({ success: true, method: "clipboard" } as const)),
  };
  const appDetector = {
    getContext: vi.fn(() => ({ appBundleId: "com.apple.TextEdit", appName: "TextEdit", context: "default" as const })),
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
      createSessionId: () => `session-${++nextSession}`,
    }
  );

  return { service, overlay, history, recorder, transcription, injector };
}

describe("DictationService FSM characterization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores stale recorder-start events for an old session", () => {
    const { service, recorder, overlay } = createService();

    service.beginHotkeySession();
    const firstSession = (service.getState() as { sessionId: string }).sessionId;
    service.cancelSession();
    service.beginHotkeySession();
    const secondSession = (service.getState() as { sessionId: string }).sessionId;

    service.reportRecorderStarted(firstSession);

    expect(service.getState()).toEqual({ status: "starting", sessionId: secondSession });
    expect(recorder.stopRecording).not.toHaveBeenCalledWith(firstSession);
    expect(overlay.setRecording).not.toHaveBeenCalled();
  });

  it("cancel during transcribing prevents the eventual transcription from injecting or saving history", async () => {
    const { service, transcription, injector, history } = createService();
    const pending = deferred<TranscriptionResult>();
    transcription.transcribe.mockReturnValueOnce(pending.promise);

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    const submit = service.submitAudioClip({ sessionId, clip: clip() });
    await Promise.resolve();

    service.cancelSession();
    pending.resolve({ rawText: "late text", formattedText: "late text", language: "en" });
    await submit;

    expect(injector.inject).not.toHaveBeenCalled();
    expect(history.append).not.toHaveBeenCalled();
    expect(service.getState()).toEqual({ status: "idle" });
  });

  it("reinjectEntry currently injects a stored entry even when recording is active", async () => {
    const { service, injector, history } = createService();

    service.beginHotkeySession();
    await service.reinjectEntry("stored");

    expect(history.getById).toHaveBeenCalledWith("stored");
    expect(injector.inject).toHaveBeenCalledWith("hello", expect.objectContaining({ appName: "TextEdit" }));
    expect(service.getState()).toMatchObject({ status: "completed", text: "hello" });
  });
});
