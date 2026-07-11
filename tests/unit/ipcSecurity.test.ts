import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcChannel } from "@shared/ipc";

const invokeHandlers = new Map<string, (...args: unknown[]) => unknown>();
const eventHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getVersion: () => "1.0.0",
    relaunch: vi.fn(),
    quit: vi.fn(),
  },
  BrowserWindow: class {},
  clipboard: { writeText: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => invokeHandlers.set(channel, handler),
    on: (channel: string, handler: (...args: unknown[]) => unknown) => eventHandlers.set(channel, handler),
  },
  shell: { openExternal: vi.fn() },
  systemPreferences: {
    isTrustedAccessibilityClient: () => true,
    getMediaAccessStatus: () => "granted",
    askForMediaAccess: vi.fn(),
  },
}));

vi.mock("electron-updater", () => ({
  autoUpdater: { checkForUpdates: vi.fn(), quitAndInstall: vi.fn() },
}));
vi.mock("@main/index", () => ({ cachedUpdateStatus: null, setCachedUpdateStatus: vi.fn() }));
vi.mock("@main/nativeBridge", () => ({ nativeBridge: {} }));
vi.mock("@main/audio/nativeCapture", () => ({ listNativeInputDevices: vi.fn(() => []) }));
vi.mock("@main/providers", () => ({
  getProviderRegistry: () => ({
    getProviderStatus: vi.fn(() => []),
    getTranscription: vi.fn(),
    getFormatting: vi.fn(),
    setActiveTranscription: vi.fn(),
    setActiveFormatting: vi.fn(),
  }),
}));
vi.mock("@main/providers/local/whisperCpp", () => ({
  loadWhisperModel: vi.fn(),
  freeWhisperModel: vi.fn(),
  listDownloadedModels: vi.fn(() => []),
  isModelLoaded: vi.fn(() => false),
}));
vi.mock("@main/providers/apiKeyValidation", () => ({ validateSubmittedApiKey: vi.fn() }));

function windowFor(sender: object) {
  return { webContents: sender, isDestroyed: () => false };
}

describe("IPC security boundaries", () => {
  const mainSender = {};
  const recorderSender = {};
  const overlaySender = {};
  const untrustedSender = {};
  const history = {
    getAll: vi.fn(() => []),
    getById: vi.fn(),
    updateById: vi.fn(),
    getLatest: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  };
  const dictation = {
    getState: vi.fn(() => ({ status: "idle" })),
    submitAudioClip: vi.fn(),
    updateAudioLevel: vi.fn(),
    navigateToHistoryEntry: vi.fn(),
  };
  const settings = {
    get: vi.fn(() => ({
      micDeviceId: undefined,
      preWarmMic: false,
      captureBackend: "renderer",
      providerApiKeys: [],
    })),
    update: vi.fn((patch) => patch),
  };

  beforeEach(async () => {
    invokeHandlers.clear();
    eventHandlers.clear();
    vi.clearAllMocks();
    const { registerIpcHandlers } = await import("@main/ipc");
    registerIpcHandlers({
      mainWindow: windowFor(mainSender),
      recorder: { getWindow: () => windowFor(recorderSender) },
      overlay: { getWindow: () => windowFor(overlaySender) },
      dictation,
      history,
      settings,
      hotkeys: { isPrimaryHotkeyActive: () => true },
    } as never);
  });

  it("allows dashboard channels only from the main renderer", async () => {
    const handler = invokeHandlers.get(IpcChannel.GetHistory);
    expect(await handler?.({ sender: mainSender })).toEqual([]);
    expect(() => handler?.({ sender: recorderSender })).toThrow("Unauthorized IPC sender");
    expect(() => handler?.({ sender: untrustedSender })).toThrow("Unauthorized IPC sender");
  });

  it("allows recorder channels only from the recorder renderer", async () => {
    const handler = invokeHandlers.get(IpcChannel.SubmitAudioClip);
    const payload = {
      sessionId: "session-1",
      clip: { pcmData: [0, 0.5], sampleRate: 16_000, durationSeconds: 0.000125, rmsFrames: [0.25] },
    };
    await handler?.({ sender: recorderSender }, payload);
    expect(dictation.submitAudioClip).toHaveBeenCalledWith(payload);
    expect(() => handler?.({ sender: mainSender }, payload)).toThrow("Unauthorized IPC sender");
  });

  it("allows the capsule command only from the overlay renderer", async () => {
    history.getLatest.mockResolvedValue({ id: "entry-1" });
    const handler = eventHandlers.get("capsule:open-last-entry");
    await handler?.({ sender: mainSender });
    expect(dictation.navigateToHistoryEntry).not.toHaveBeenCalled();
    await handler?.({ sender: overlaySender });
    expect(dictation.navigateToHistoryEntry).toHaveBeenCalledWith("entry-1");
  });

  it("rejects malformed renderer payloads before calling services", async () => {
    await invokeHandlers.get(IpcChannel.UpdateHistoryEntry)?.(
      { sender: mainSender },
      "",
      { forged: true },
    );
    await invokeHandlers.get(IpcChannel.ReportAudioFrame)?.(
      { sender: recorderSender },
      { level: Number.NaN, bars: [2] },
    );
    await invokeHandlers.get(IpcChannel.UpdateSettings)?.(
      { sender: mainSender },
      { unknownSetting: true },
    );

    expect(history.updateById).not.toHaveBeenCalled();
    expect(dictation.updateAudioLevel).not.toHaveBeenCalled();
    expect(settings.update).not.toHaveBeenCalled();
  });
});
