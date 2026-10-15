import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcChannel } from "@shared/ipc";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { DictationEntry, Settings } from "@shared/types";
import { CredentialsStore, MemoryCredentialBackend } from "@main/store/credentials";

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
    getMediaAccessStatus: vi.fn(() => "granted"),
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

function windowFor(sender: { send: (...args: unknown[]) => void }) {
  return { webContents: sender, isDestroyed: () => false };
}

describe("IPC security boundaries", () => {
  const mainSender = { send: vi.fn() };
  const recorderSender = { send: vi.fn() };
  const overlaySender = { send: vi.fn() };
  const untrustedSender = { send: vi.fn() };
  const history = {
    getAll: vi.fn(async (): Promise<DictationEntry[]> => []),
    getById: vi.fn(),
    updateById: vi.fn(),
    getLatest: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  };
  const dictation = {
    getState: vi.fn(() => ({ status: "idle" as const })),
    getTrace: vi.fn(),
    getActiveSessionForLifecycle: vi.fn(() => null),
    reinjectEntry: vi.fn(),
    retryEntry: vi.fn(),
    copyRecoveryEntry: vi.fn(),
    retryRecoveryTranscription: vi.fn(),
    retryRecoveryFormatting: vi.fn(),
    useRawRecoveryTranscript: vi.fn(),
    retryRecoveryInsertion: vi.fn(),
    exportBugReport: vi.fn(),
    showDictionarySuggestions: vi.fn(),
    purgeAutoSuggestedCorrections: vi.fn(() => DEFAULT_SETTINGS),
    submitAudioClip: vi.fn(),
    reportRecorderReady: vi.fn(),
    reportRecorderStarted: vi.fn(),
    updateAudioLevel: vi.fn(),
    handleRecorderFailure: vi.fn(),
    demoTranscribe: vi.fn(),
    navigateToHistoryEntry: vi.fn(),
  };
  const onSettingsUpdated = vi.fn();
  const settings = {
    get: vi.fn(() => DEFAULT_SETTINGS),
    update: vi.fn((patch: Partial<Settings>) => ({ ...DEFAULT_SETTINGS, ...patch })),
    flush: vi.fn(async (): Promise<void> => undefined),
  };

  beforeEach(async () => {
    invokeHandlers.clear();
    eventHandlers.clear();
    vi.clearAllMocks();
    const { registerIpcHandlers } = await import("@main/ipc");
    registerIpcHandlers({
      mainWindow: windowFor(mainSender),
      recorder: { getWindow: () => windowFor(recorderSender), markReady: vi.fn() },
      overlay: { getWindow: () => windowFor(overlaySender) },
      dictation,
      history,
      settings,
      onSettingsUpdated,
      hotkeys: { isPrimaryHotkeyActive: () => true, reregister: vi.fn(), setCaptureActive: vi.fn() },
    });
  });

  it("exposes disabled recovery without reading storage and protects its IPC sender", async () => {
    await expect(invokeHandlers.get(IpcChannel.GetRecoveryReadiness)?.({ sender: mainSender })).resolves.toEqual({ state: "disabled", entryCount: null });
    await expect(invokeHandlers.get(IpcChannel.GetRecoveryReadiness)?.({ sender: untrustedSender })).rejects.toThrow("Unauthorized IPC sender");
  });

  it.each([false, true])("reports readiness and storage failure independently from empty content (%s)", async (fails) => {
    const { registerIpcHandlers } = await import("@main/ipc");
    registerIpcHandlers({
      mainWindow: windowFor(mainSender), dictation, history, settings,
      hotkeys: { isPrimaryHotkeyActive: () => true, reregister: vi.fn(), setCaptureActive: vi.fn() },
      recoveryReadiness: () => ({ state: "ready", entryCount: null }),
      recovery: { getById: vi.fn(), getUnresolved: vi.fn(async () => { if (fails) throw new Error("disk failed"); return []; }) },
    });
    await expect(invokeHandlers.get(IpcChannel.GetRecoveryReadiness)?.({ sender: mainSender })).resolves.toEqual(fails ? { state: "degraded", entryCount: null } : { state: "ready", entryCount: 0 });
  });

  it("allows dashboard channels only from the main renderer", async () => {
    const handler = invokeHandlers.get(IpcChannel.GetHistory);
    expect(await handler?.({ sender: mainSender })).toEqual([]);
    expect(() => handler?.({ sender: recorderSender })).toThrow("Unauthorized IPC sender");
    expect(() => handler?.({ sender: untrustedSender })).toThrow("Unauthorized IPC sender");
  });

  it.each(["saveRecordings", "retainFailedAudio"] as const)("waits for %s consent to persist before acknowledging it", async (field) => {
    let finishWrite: () => void = () => { throw new Error("write was not started"); };
    const write = new Promise<void>((resolve) => { finishWrite = resolve; });
    settings.flush.mockReturnValueOnce(write);
    const settled = vi.fn();
    const pending = Promise.resolve(invokeHandlers.get(IpcChannel.UpdateSettings)?.({ sender: mainSender }, { [field]: false }));
    void pending.then(settled);
    await Promise.resolve();
    expect(settings.flush).toHaveBeenCalledTimes(1);
    expect(onSettingsUpdated).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ [field]: false }));
    expect(settled).not.toHaveBeenCalled();
    finishWrite();
    await expect(pending).resolves.toHaveProperty(field, false);
  });

  it("reports consent persistence failure instead of acknowledging a saved preference", async () => {
    settings.flush.mockRejectedValueOnce(new Error("disk unavailable"));
    await expect(invokeHandlers.get(IpcChannel.UpdateSettings)?.({ sender: mainSender }, { retainFailedAudio: false })).rejects.toThrow("disk unavailable");
  });

  it("returns the live post-request microphone status", async () => {
    const { systemPreferences } = await import("electron");
    vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue("not-determined");
    vi.mocked(systemPreferences.askForMediaAccess).mockImplementation(async () => {
      vi.mocked(systemPreferences.getMediaAccessStatus).mockReturnValue("denied");
      return false;
    });

    const status = await invokeHandlers.get(IpcChannel.RequestMicrophonePermission)?.({ sender: mainSender });

    expect(status).toBe("denied");
    expect(systemPreferences.askForMediaAccess).toHaveBeenCalledWith("microphone");
  });

  it("preserves microphone request failures for the renderer", async () => {
    const { systemPreferences } = await import("electron");
    const failure = new Error("permission request failed");
    vi.mocked(systemPreferences.askForMediaAccess).mockRejectedValueOnce(failure);

    await expect(invokeHandlers.get(IpcChannel.RequestMicrophonePermission)?.({ sender: mainSender })).rejects.toBe(failure);
  });

  it("refuses to copy text with no words or numbers", async () => {
    const { clipboard } = await import("electron");
    const handler = invokeHandlers.get(IpcChannel.CopyText);

    expect(await handler?.({ sender: mainSender }, "...")).toBe(false);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(await handler?.({ sender: mainSender }, "Hello.")).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith("Hello.");
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

  it("drops recorder submissions whose capture settings are not boolean flags", async () => {
    const handler = invokeHandlers.get(IpcChannel.SubmitAudioClip);
    const submit = vi.mocked(dictation.submitAudioClip);
    submit.mockClear();
    const clip = { pcmData: [0, 0.5], sampleRate: 16_000, durationSeconds: 0.000125, rmsFrames: [0.25], gain: 2 };
    await handler?.({ sender: recorderSender }, { sessionId: "session-1", clip, captureSettings: { echoCancellation: true } });
    expect(submit).toHaveBeenCalledTimes(1);
    await handler?.({ sender: recorderSender }, { sessionId: "session-1", clip, captureSettings: { echoCancellation: "yes" } });
    expect(submit).toHaveBeenCalledTimes(1);
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

  it("sets one provider key without changing the other stored credentials", async () => {
    const backend = new MemoryCredentialBackend();
    const credentials = new CredentialsStore(backend);
    await credentials.set("openai", "openai-secret");
    await credentials.set("groq", "groq-secret");
    await credentials.set("deepgram", "deepgram-secret");

    const { registerIpcHandlers } = await import("@main/ipc");
    registerIpcHandlers({
      mainWindow: windowFor(mainSender),
      recorder: { getWindow: () => windowFor(recorderSender), markReady: vi.fn() },
      overlay: { getWindow: () => windowFor(overlaySender) },
      dictation,
      history,
      settings,
      hotkeys: { isPrimaryHotkeyActive: () => true, reregister: vi.fn(), setCaptureActive: vi.fn() },
      credentials,
    });

    await invokeHandlers.get(IpcChannel.SetProviderApiKey)?.(
      { sender: mainSender },
      "openai",
      "openai-updated",
    );

    expect(await credentials.get("openai")).toBe("openai-updated");
    expect(await credentials.get("groq")).toBe("groq-secret");
    expect(await credentials.get("deepgram")).toBe("deepgram-secret");
  });

  it("persists sanitized provider key validation state through save, test, and clear", async () => {
    const backend = new MemoryCredentialBackend();
    const credentials = new CredentialsStore(backend);
    const state: Settings = { ...DEFAULT_SETTINGS, providerApiKeys: [] };
    const stateStore = {
      flush: vi.fn(async (): Promise<void> => undefined),
      get: vi.fn(() => state),
      update: vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch)),
    };
    const { validateSubmittedApiKey } = await import("@main/providers/apiKeyValidation");
    vi.mocked(validateSubmittedApiKey).mockResolvedValue({ valid: true, message: "Provider API key is valid." });

    const { registerIpcHandlers } = await import("@main/ipc");
    registerIpcHandlers({
      mainWindow: windowFor(mainSender),
      recorder: { getWindow: () => windowFor(recorderSender), markReady: vi.fn() },
      overlay: { getWindow: () => windowFor(overlaySender) },
      dictation,
      history,
      settings: stateStore,
      hotkeys: { isPrimaryHotkeyActive: () => true, reregister: vi.fn(), setCaptureActive: vi.fn() },
      credentials,
    });

    const saved = await invokeHandlers.get(IpcChannel.SetProviderApiKey)?.(
      { sender: mainSender },
      "openai",
      "openai-secret",
    ) as Settings;
    expect(saved.providerApiKeys).toEqual([{
      providerId: "openai",
      key: "",
      hasKey: true,
      lastValidation: null,
    }]);
    expect(JSON.stringify(saved)).not.toContain("openai-secret");

    await invokeHandlers.get(IpcChannel.TestApiKey)?.({ sender: mainSender }, "openai", "openai-secret");
    expect(state.providerApiKeys[0]?.lastValidation).toMatchObject({
      valid: true,
      message: "Provider API key is valid.",
    });
    expect(state.providerApiKeys[0]?.lastValidation?.testedAt).toEqual(expect.any(String));

    const cleared = await invokeHandlers.get(IpcChannel.ClearProviderApiKey)?.(
      { sender: mainSender },
      "openai",
    ) as Settings;
    expect(cleared.providerApiKeys).toEqual([{
      providerId: "openai",
      key: "",
      hasKey: false,
      lastValidation: null,
    }]);
  });

  it("clears exactly the named provider credential", async () => {
    const backend = new MemoryCredentialBackend();
    const credentials = new CredentialsStore(backend);
    await credentials.set("openai", "openai-secret");
    await credentials.set("groq", "groq-secret");
    await credentials.set("deepgram", "deepgram-secret");
    const deleteCredential = vi.spyOn(backend, "delete");

    const { registerIpcHandlers } = await import("@main/ipc");
    registerIpcHandlers({
      mainWindow: windowFor(mainSender),
      recorder: { getWindow: () => windowFor(recorderSender), markReady: vi.fn() },
      overlay: { getWindow: () => windowFor(overlaySender) },
      dictation,
      history,
      settings,
      hotkeys: { isPrimaryHotkeyActive: () => true, reregister: vi.fn(), setCaptureActive: vi.fn() },
      credentials,
    });

    await invokeHandlers.get(IpcChannel.ClearProviderApiKey)?.(
      { sender: mainSender },
      "openai",
    );

    expect(deleteCredential).toHaveBeenCalledTimes(1);
    expect(deleteCredential).toHaveBeenCalledWith("openai");
    expect(await credentials.has("openai")).toBe(false);
    expect(await credentials.has("groq")).toBe(true);
    expect(await credentials.has("deepgram")).toBe(true);
  });

  it("does not delete credentials when settings carries redacted provider keys", async () => {
    const backend = new MemoryCredentialBackend();
    const credentials = new CredentialsStore(backend);
    await credentials.set("openai", "openai-secret");
    await credentials.set("groq", "groq-secret");
    await credentials.set("deepgram", "deepgram-secret");
    const deleteCredential = vi.spyOn(backend, "delete");

    const { registerIpcHandlers } = await import("@main/ipc");
    registerIpcHandlers({
      mainWindow: windowFor(mainSender),
      recorder: { getWindow: () => windowFor(recorderSender), markReady: vi.fn() },
      overlay: { getWindow: () => windowFor(overlaySender) },
      dictation,
      history,
      settings,
      hotkeys: { isPrimaryHotkeyActive: () => true, reregister: vi.fn(), setCaptureActive: vi.fn() },
      credentials,
    });

    await invokeHandlers.get(IpcChannel.UpdateSettings)?.(
      { sender: mainSender },
      {
        providerApiKeys: [
          { providerId: "openai", key: "" },
          { providerId: "groq", key: "" },
          { providerId: "deepgram", key: "" },
        ],
      },
    );

    expect(deleteCredential).not.toHaveBeenCalled();
    expect(await credentials.has("openai")).toBe(true);
    expect(await credentials.has("groq")).toBe(true);
    expect(await credentials.has("deepgram")).toBe(true);
  });

  it("preserves dictionary metadata through a settings round-trip", async () => {
    const correction = {
      spoken: "get hub",
      written: "GitHub",
      source: "auto-suggested" as const,
      fuzzy: true,
      enabled: false,
      hitCount: 7,
      lastUsedAt: "2026-08-07T00:00:00.000Z",
    };

    await invokeHandlers.get(IpcChannel.UpdateSettings)?.(
      { sender: mainSender },
      { customCorrections: [correction] },
    );

    expect(settings.update).toHaveBeenCalledWith({ customCorrections: [correction] });
  });

  it("keeps an empty replacement when editing a dictionary removal rule", async () => {
    await invokeHandlers.get(IpcChannel.UpdateSettings)?.(
      { sender: mainSender },
      { customCorrections: [{ spoken: "filler", written: "", source: "manual" }] },
    );

    expect(settings.update).toHaveBeenCalledWith({
      customCorrections: [{ spoken: "filler", written: "", source: "manual" }],
    });
  });

  it("rejects the whole dictionary update when a correction is oversized or has malformed optional metadata", async () => {
    await invokeHandlers.get(IpcChannel.UpdateSettings)?.(
      { sender: mainSender },
      {
        customCorrections: [
          { spoken: "x".repeat(41), written: "replacement" },
          { spoken: "fuzzy rule", written: "Fuzzy rule", fuzzy: "yes", hitCount: -1 },
        ],
      },
    );

    expect(settings.update).not.toHaveBeenCalled();
  });

  it("defaults a new dictionary entry without source to manual", async () => {
    await invokeHandlers.get(IpcChannel.UpdateSettings)?.(
      { sender: mainSender },
      { customCorrections: [{ spoken: "onkar", written: "Onkar" }] },
    );

    expect(settings.update).toHaveBeenCalledWith({
      customCorrections: [{ spoken: "onkar", written: "Onkar", source: "manual" }],
    });
  });

  it("fences recovery reads, actions, and storage mutation while readiness is disabled", async () => {
    const recovery = {
      getUnresolved: vi.fn(async () => []),
      getById: vi.fn(),
      getAll: vi.fn(async () => []),
    };
    const recoveryAudio = {
      deleteAudio: vi.fn(),
      discard: vi.fn(),
      cleanupExpired: vi.fn(),
      getStorageUsage: vi.fn(),
      playDecryptedAudio: vi.fn(),
    };
    const { registerIpcHandlers } = await import("@main/ipc");
    registerIpcHandlers({
      mainWindow: windowFor(mainSender),
      recorder: { getWindow: () => windowFor(recorderSender), markReady: vi.fn() },
      overlay: { getWindow: () => windowFor(overlaySender) },
      dictation,
      history,
      settings,
      hotkeys: { isPrimaryHotkeyActive: () => true, reregister: vi.fn(), setCaptureActive: vi.fn() },
      recovery,
      recoveryAudio,
      recoveryReady: () => false,
      consumeRestoredRecoveryNotice: vi.fn(),
    });

    expect(await invokeHandlers.get(IpcChannel.GetRecoveryEntries)?.({ sender: mainSender })).toEqual([]);
    expect(await invokeHandlers.get(IpcChannel.GetRecoveryRestored)?.({ sender: mainSender })).toBeNull();
    expect(await invokeHandlers.get(IpcChannel.CopyRecoveryEntry)?.({ sender: mainSender }, "entry")).toBe(false);
    expect(await invokeHandlers.get(IpcChannel.RetryRecoveryTranscription)?.({ sender: mainSender }, "entry")).toBe(false);
    expect(await invokeHandlers.get(IpcChannel.RetryRecoveryFormatting)?.({ sender: mainSender }, "entry")).toBe(false);
    expect(await invokeHandlers.get(IpcChannel.UseRawRecoveryTranscript)?.({ sender: mainSender }, "entry")).toBe(false);
    expect(await invokeHandlers.get(IpcChannel.RetryRecoveryInsertion)?.({ sender: mainSender }, "entry")).toBe(false);
    expect(await invokeHandlers.get(IpcChannel.PlayRecoveryAudio)?.({ sender: mainSender }, "entry")).toBe(false);
    expect(await invokeHandlers.get(IpcChannel.DeleteRecoveryAudio)?.({ sender: mainSender }, "entry")).toBe(false);
    expect(await invokeHandlers.get(IpcChannel.DiscardRecoveryEntry)?.({ sender: mainSender }, "entry")).toBe(false);
    expect(await invokeHandlers.get(IpcChannel.GetRecoveryStorageUsage)?.({ sender: mainSender })).toEqual({ bytes: 0, sessions: 0 });
    expect(await invokeHandlers.get(IpcChannel.CleanupRecoveryAudio)?.({ sender: mainSender })).toEqual({ bytes: 0, sessions: 0 });
    expect(await invokeHandlers.get(IpcChannel.ClearRecoveryAudio)?.({ sender: mainSender })).toEqual({ bytes: 0, sessions: 0 });
    expect(recovery.getUnresolved).not.toHaveBeenCalled();
    expect(recoveryAudio.cleanupExpired).not.toHaveBeenCalled();
    expect(recoveryAudio.deleteAudio).not.toHaveBeenCalled();
  });
});
