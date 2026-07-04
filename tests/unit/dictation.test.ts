import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import { IpcChannel } from "@shared/ipc";
import type { AudioVisualFrame, DictationTrace, Settings, TranscriptionResult } from "@shared/types";
import type { DictationTraceStore } from "@main/store/dictationTrace";
import { DictationService } from "./dictation.fixture";
import { nativeBridge } from "@main/nativeBridge";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
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
  }
}));

function createDictationService(deps: { traces?: Pick<DictationTraceStore, "upsert" | "updateById" | "getById" | "getBySessionId"> } = {}) {
  let focusedValue = "";
  (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn(() => focusedValue);
  (nativeBridge as { getFocusedSelection?: () => { location: number; length: number } | null }).getFocusedSelection = vi.fn(() => ({
    location: focusedValue.length,
    length: 0,
  }));

  const overlay = {
    setPressed: vi.fn(),
    setRecording: vi.fn(),
    setProcessing: vi.fn(),
    setSuccess: vi.fn(),
    setError: vi.fn(),
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
    stopRecording: vi.fn(() => true)
  };

  const transcription = {
    transcribe: vi.fn(async (): Promise<TranscriptionResult> => ({ rawText: "open get hub", formattedText: "open get hub", language: "en" })),
    formatTranscript: vi.fn(async (text: string) => text)
  };

  const injector = {
    inject: vi.fn(async (text: string) => {
      focusedValue += text;
      return { success: true, method: "clipboard" } as const;
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
    { recorder, transcription, injector, appDetector, traces: deps.traces }
  );

  return { service, overlay, mainWindow, history, recorder, settings, transcription, injector, appDetector };
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

describe("DictationService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("errors if recording starts but no real audio frames arrive", () => {
    const { service, overlay, recorder } = createDictationService();

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    vi.advanceTimersByTime(1_600);

    expect(recorder.stopRecording).toHaveBeenCalledWith(sessionId);
    expect(overlay.setError).toHaveBeenCalledTimes(1);
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

    expect(injector.inject).toHaveBeenCalledWith(cleanedText, expect.anything());
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({
      rawText,
      cleanedText,
      injectionStatus: "injected",
    }));
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

    expect(injector.inject).toHaveBeenCalledWith("I like this.", expect.anything());
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({
      rawText: "um I like this",
      formattedText: "um I like this",
      cleanedText: "I like this.",
    }));
    const updatedTrace = trace as DictationTrace | null;
    expect(updatedTrace?.stages).toMatchObject({
      cleanedText: "I like this.",
      formatterUsed: "guard-fallback",
      contentGuardVerdict: { passed: false, missingWords: ["like"] },
    });
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
    expect(service.getState()).toMatchObject({ status: "completed", outcome: "saved", message: "Saved to history" });
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
      expect.anything(),
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
      expect.anything(),
    );
    const updatedTrace = trace as DictationTrace | null;
    expect(updatedTrace?.rawAudio?.durationSeconds).toBe(31);
    expect(updatedTrace?.trimmedAudio?.durationSeconds).toBeLessThan(31);
  });

  it("repairs a safely detectable partial insertion with the missing suffix", async () => {
    const { service, history, injector, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    injector.inject.mockResolvedValue({ success: true, method: "clipboard" });
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn()
      .mockReturnValueOnce("")
      .mockReturnValueOnce("Hello")
      .mockReturnValueOnce("Hello world.");

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    expect(injector.inject).toHaveBeenNthCalledWith(1, "Hello world.", expect.anything());
    expect(injector.inject).toHaveBeenNthCalledWith(2, " world.", expect.anything());
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({
      injectionStatus: "injected",
      injectionMethod: "clipboard",
    }));
  });

  it("saves to history when insertion verification is unreadable", async () => {
    const { service, history, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "hello world", formattedText: "hello world", language: "en" });
    (nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn()
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

    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({
      cleanedText: "Hello world.",
      injectionStatus: "saved",
      injectionMethod: null,
    }));
    expect(service.getState()).toMatchObject({ status: "completed", outcome: "saved", message: "Saved to history" });
  });

  it("redacts local audio paths from exported bug reports", async () => {
    const trace: DictationTrace = {
      id: "trace-1",
      sessionId: "session-1",
      startedAt: "2026-06-29T00:00:00.000Z",
      targetAppBundleId: "com.apple.TextEdit",
      targetAppName: "TextEdit",
      outcome: "saved",
      rawAudioPath: "/Users/onkarj012/Documents/Vaani Recordings/raw.wav",
    };
    const traces = {
      upsert: vi.fn(),
      updateById: vi.fn(),
      getById: vi.fn(async () => trace),
      getBySessionId: vi.fn(),
    };
    const { service, history } = createDictationService({ traces });
    history.getById.mockResolvedValue({
      id: "entry-1",
      traceId: "trace-1",
      timestamp: "2026-06-29T00:00:00.000Z",
      rawText: "hello",
      formattedText: "hello",
      cleanedText: "Hello.",
      durationSeconds: 1,
      appBundleId: "com.apple.TextEdit",
      appName: "TextEdit",
      injectionStatus: "saved",
      injectionMethod: null,
      language: "en",
      rawAudioPath: "/Users/onkarj012/Documents/Vaani Recordings/raw.wav",
    });

    const report = await service.exportBugReport("entry-1", "1.2.3");

    expect(report.entry?.rawAudioPath).toBeNull();
    expect(report.trace?.rawAudioPath).toBeNull();
  });

  it("auto-adds a dictionary correction shortly after the user edits inserted text", async () => {
    const { service, overlay, history, settings } = createDictationService();
    const nativeBridge = await import("@main/nativeBridge");
    const getFocusedValue = vi.fn()
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

  it("ignores stale dictionary undo responses from an older generation", async () => {
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
    expect(mutable.current().customCorrections).toEqual([
      { spoken: "get hub", written: "GitHub", source: "auto-suggested" }
    ]);
    const respond = resolvePrompt;
    service.beginHotkeySession();
    respond(false);
    await pending;

    expect(mutable.current().customCorrections).toEqual([
      { spoken: "get hub", written: "GitHub", source: "auto-suggested" }
    ]);
  });

  it("undoes an auto-added dictionary correction from the toast", async () => {
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

  it("waits for editing to settle before auto-adding a dictionary rule", async () => {
    const { service, overlay, settings, transcription } = createDictationService();
    // "versel" is a realistic Whisper mishear of "Vercel" (close edit distance)
    transcription.transcribe.mockResolvedValue({ rawText: "use versel", formattedText: "use versel", language: "en" });
    const nativeBridge = await import("@main/nativeBridge");
    const getFocusedValue = vi.fn()
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
