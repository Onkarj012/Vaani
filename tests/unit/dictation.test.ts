import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import { IpcChannel } from "@shared/ipc";
import type { AudioVisualFrame } from "@shared/types";
import { DictationService } from "./dictation.fixture";

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

function createDictationService() {
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
    transcribe: vi.fn(async () => ({ rawText: "open get hub", formattedText: "open get hub", language: "en" })),
    formatTranscript: vi.fn(async (text: string) => text)
  };

  const injector = {
    inject: vi.fn(async () => ({ success: true, method: "clipboard" } as const))
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
    { recorder, transcription, injector, appDetector }
  );

  return { service, overlay, mainWindow, history, recorder, settings, transcription, injector, appDetector };
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

  it("prompts for a dictionary rule shortly after the user edits inserted text", async () => {
    const { service, overlay, history } = createDictationService();
    const nativeBridge = await import("@main/nativeBridge");
    const getFocusedValue = vi.fn()
      .mockReturnValueOnce("open get hub")
      .mockReturnValue("open GitHub");
    (nativeBridge.nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = getFocusedValue;

    service.beginHotkeySession();
    const sessionId = (service.getState() as { sessionId: string }).sessionId;
    service.reportRecorderStarted(sessionId);
    service.endHotkeySession();
    await service.submitAudioClip({
      sessionId,
      clip: { pcmData: new Array(16_000).fill(0.1), sampleRate: 16_000, durationSeconds: 1, rmsFrames: [0.1] }
    });

    vi.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(overlay.showDictionaryPrompt).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_000);
    await Promise.resolve();

    expect(history.append).toHaveBeenCalledTimes(1);
    expect(overlay.showDictionaryPrompt).toHaveBeenCalledWith("get hub", "GitHub", expect.any(Function));
  });

  it("prompts to save a snippet when the edited text is a phrase, not a word correction", async () => {
    const { service, overlay, settings, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "my email", formattedText: "my email", language: "en" });
    const nativeBridge = await import("@main/nativeBridge");
    (nativeBridge.nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn()
      .mockReturnValueOnce("my email")
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

  it("waits for editing to settle before suggesting a dictionary rule (settle timing test)", async () => {
    const { service, overlay, transcription } = createDictationService();
    // "versel" is a realistic Whisper mishear of "Vercel" (close edit distance)
    transcription.transcribe.mockResolvedValue({ rawText: "versel", formattedText: "versel", language: "en" });
    const nativeBridge = await import("@main/nativeBridge");
    const getFocusedValue = vi.fn()
      .mockReturnValueOnce("versel")
      .mockReturnValueOnce("Ve")
      .mockReturnValueOnce("Verc")
      .mockReturnValue("Vercel");
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

    expect(overlay.showDictionaryPrompt).toHaveBeenCalledWith("Versel", "Vercel", expect.any(Function));
  });

  it("does not suggest snippets for ordinary phrase edits", async () => {
    const { service, overlay, transcription } = createDictationService();
    transcription.transcribe.mockResolvedValue({ rawText: "sentence", formattedText: "sentence", language: "en" });
    const nativeBridge = await import("@main/nativeBridge");
    (nativeBridge.nativeBridge as { getFocusedValue?: () => string | null }).getFocusedValue = vi.fn()
      .mockReturnValueOnce("sentence")
      .mockReturnValue("sentence about the release notes");

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
      .mockReturnValueOnce("sentence")
      .mockReturnValue("sentence: review the API/auth flow");

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
