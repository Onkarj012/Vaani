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
}), { virtual: true });

function createDictationService() {
  const overlay = {
    setPressed: vi.fn(),
    setRecording: vi.fn(),
    setProcessing: vi.fn(),
    setSuccess: vi.fn(),
    setError: vi.fn(),
    hide: vi.fn(),
    updateBars: vi.fn()
  };

  const mainWindow = {
    webContents: {
      send: vi.fn()
    }
  };

  const settings = {
    get: () => DEFAULT_SETTINGS
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

  const service = new DictationService(
    mainWindow as never,
    settings as never,
    history as never,
    vi.fn(),
    overlay as never,
    { recorder }
  );

  return { service, overlay, mainWindow, history, recorder };
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
});
