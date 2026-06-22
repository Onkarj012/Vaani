import { app, BrowserWindow, clipboard, ipcMain, shell, systemPreferences } from "electron";
import { join } from "node:path";
import { homedir } from "node:os";
import { autoUpdater } from "electron-updater";
import { IpcChannel } from "@shared/ipc";
import { assertValidWhisperModelName } from "@shared/whisperModels";
import { KNOWN_PROVIDERS } from "@shared/defaults";
import type { DictionarySuggestion } from "@shared/dictionarySuggestions";
import type {
  AudioVisualFrame,
  MacOSPermissionState,
  PermissionStatus,
  RecorderFailure,
  RecorderSubmission,
  Settings,
  UpdateNotificationPayload
} from "@shared/types";
import { DictationService } from "./dictation";
import { HistoryStore } from "./store/history";
import { SettingsStore } from "./store/settings";
import { CredentialsStore, sanitizeSettingsForRenderer } from "./store/credentials";
import { HotkeyManager } from "./hotkeys";
import { nativeBridge } from "./nativeBridge";
import { RecorderWindowController } from "./recorderWindow";
import { getProviderRegistry } from "./providers";
import { detectDictionarySuggestions } from "@shared/dictionarySuggestions";
import { loadWhisperModel, freeWhisperModel, listDownloadedModels, isModelLoaded } from "./providers/local/whisperCpp";
import { cachedUpdateStatus, setCachedUpdateStatus } from "./index";
import { validateSubmittedApiKey } from "./providers/apiKeyValidation";

function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => {
    const cleaned = v.replace(/^v/, "");
    return cleaned.split(".").map((part) => {
      const num = Number(part);
      return Number.isNaN(num) ? -1 : num;
    });
  };
  const l = parse(latest);
  const c = parse(current);
  if (l.some((n) => n < 0) || c.some((n) => n < 0)) return false;
  const maxLen = Math.max(l.length, c.length);
  for (let i = 0; i < maxLen; i++) {
    const li = l[i] ?? 0;
    const ci = c[i] ?? 0;
    if (li > ci) return true;
    if (li < ci) return false;
  }
  return false;
}

function normalizeMediaStatus(status: string): MacOSPermissionState {
  switch (status) {
    case "not-determined":
    case "granted":
    case "denied":
    case "restricted":
      return status;
    default:
      return "unknown";
  }
}

function getPermissionStatus(): PermissionStatus {
  const accessibilityTrusted = systemPreferences.isTrustedAccessibilityClient(false);
  return {
    microphone: normalizeMediaStatus(systemPreferences.getMediaAccessStatus("microphone")),
    accessibility: accessibilityTrusted ? "granted" : "denied"
  };
}

async function buildRendererApiKeys(
  providerApiKeys: Array<{ providerId: string; key: string }>,
  credentials: CredentialsStore
): Promise<Array<{ providerId: string; key: string; hasKey: boolean }>> {
  const mapped = await Promise.all(
    providerApiKeys.map(async (pk) => ({
      providerId: pk.providerId,
      key: '',
      hasKey: await credentials.has(pk.providerId),
    }))
  );
  const hasGroq = mapped.some((pk) => pk.providerId === 'groq');
  if (!hasGroq) {
    const groqHasKey = await credentials.has('groq');
    if (groqHasKey) {
      mapped.push({ providerId: 'groq', key: '', hasKey: true });
    }
  }
  return mapped;
}

async function openPermissionSettings(permission: keyof PermissionStatus): Promise<void> {
  const pane = permission === "microphone" ? "Privacy_Microphone" : "Privacy_Accessibility";
  await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
}

export function registerIpcHandlers(opts: {
  mainWindow: BrowserWindow | null;
  dictation: DictationService;
  history: HistoryStore;
  settings: SettingsStore;
  hotkeys: HotkeyManager;
  recorder?: RecorderWindowController;
  credentials?: CredentialsStore;
  onSettingsUpdated?: (settings: Settings, patch: Partial<Settings>) => void;
}): void {
  const { mainWindow, dictation, history, settings, hotkeys, recorder, credentials, onSettingsUpdated } = opts;
  let lastAccessibilityGranted = getPermissionStatus().accessibility === "granted";
  let lastPermissionHotkeyRefresh = 0;

  function refreshPermissionStatus(): PermissionStatus {
    const current = getPermissionStatus();
    const accessibilityGranted = current.accessibility === "granted";
    const shouldRefreshHotkeys =
      accessibilityGranted &&
      (!lastAccessibilityGranted || !hotkeys.isPrimaryHotkeyActive()) &&
      Date.now() - lastPermissionHotkeyRefresh > 5_000;

    lastAccessibilityGranted = accessibilityGranted;
    if (shouldRefreshHotkeys) {
      lastPermissionHotkeyRefresh = Date.now();
      hotkeys.reregister();
    }
    return current;
  }

  function sendUpdateNotification(payload: UpdateNotificationPayload): void {
    setCachedUpdateStatus(payload);
    mainWindow?.webContents.send(IpcChannel.UpdateNotification, payload);
  }

  ipcMain.handle(IpcChannel.GetDictationState, () => dictation.getState());
  ipcMain.handle(IpcChannel.GetHistory, () => history.getAll());
  ipcMain.handle(IpcChannel.UpdateHistoryEntry, async (_e, id: string, cleanedText: string) => {
    const entry = await history.getById(id);
    const updated = await history.updateById(id, (entry) => ({ ...entry, cleanedText }));
    
    // Detect if the user made manual word corrections and prompt to save as dictionary rule
    if (entry && updated) {
      const suggestions = detectDictionarySuggestions(entry.cleanedText, updated.cleanedText);
      if (suggestions.length > 0) {
        void dictation.showDictionarySuggestions(suggestions);
      }
    }
    
    return updated;
  });
  ipcMain.handle(IpcChannel.ReinjectEntry, (_e, id: string) => dictation.reinjectEntry(id));
  ipcMain.handle(IpcChannel.DeleteEntry, (_e, id: string) => history.delete(id));
  ipcMain.handle(IpcChannel.ClearHistory, () => history.clear());
  ipcMain.handle(IpcChannel.CopyText, (_e, text: string) => {
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle(IpcChannel.GetSettings, async () => {
    const s = settings.get();
    const sanitized = sanitizeSettingsForRenderer(s);
    if (credentials) {
      sanitized.providerApiKeys = await buildRendererApiKeys(s.providerApiKeys ?? [], credentials);
    }
    return sanitized;
  });

  ipcMain.handle(IpcChannel.UpdateSettings, async (_e, patch: Partial<Settings>) => {
    const credentialPatch = patch;
    let settingsPatch: Partial<Settings> = { ...patch };

    if (credentials) {
      for (const pk of credentialPatch.providerApiKeys ?? []) {
        if (!pk.providerId) continue;
        if (pk.key) {
          await credentials.set(pk.providerId, pk.key);
        }
      }
      if (credentialPatch.groqApiKey) {
        await credentials.set("groq", credentialPatch.groqApiKey);
      }
      if ("groqApiKey" in settingsPatch) {
        settingsPatch.groqApiKey = "";
      }
      if ("providerApiKeys" in settingsPatch) {
        settingsPatch.providerApiKeys = (settingsPatch.providerApiKeys ?? []).map((pk) => ({ providerId: pk.providerId, key: "" }));
      }
    }

    if ("formattingProvider" in settingsPatch && typeof settingsPatch.formattingProvider === "string" && !("formattingModel" in settingsPatch)) {
      const provider = KNOWN_PROVIDERS.find((candidate) => candidate.id === settingsPatch.formattingProvider);
      if (provider?.type === "llm") {
        settingsPatch = { ...settingsPatch, formattingModel: provider.defaultModel };
      }
    }

    const updated = settings.update(settingsPatch);
    if ("primaryHotkey" in settingsPatch || "pasteLatestHotkey" in settingsPatch) {
      hotkeys.reregister();
    }
    // Update provider registry when provider or key settings change
    if ("transcriptionProvider" in settingsPatch) {
      getProviderRegistry().setActiveTranscription(updated.transcriptionProvider);
    }
    if ("formattingProvider" in settingsPatch) {
      getProviderRegistry().setActiveFormatting(updated.formattingProvider);
    }
    onSettingsUpdated?.(updated, settingsPatch);
    const sanitized = sanitizeSettingsForRenderer(updated);
    if (credentials) {
      sanitized.providerApiKeys = await buildRendererApiKeys(updated.providerApiKeys ?? [], credentials);
    }
    return sanitized;
  });
  ipcMain.handle(IpcChannel.SetHotkeyCapture, (_e, active: boolean) => {
    hotkeys.setCaptureActive(active);
  });
  ipcMain.handle(IpcChannel.ShowDictionaryPrompt, (_e, suggestions: DictionarySuggestion[]) => (
    dictation.showDictionarySuggestions(suggestions)
  ));
  ipcMain.handle(IpcChannel.GetPermissionStatus, () => refreshPermissionStatus());
  ipcMain.handle(IpcChannel.RequestMicrophonePermission, async () => {
    await systemPreferences.askForMediaAccess("microphone");
    return normalizeMediaStatus(systemPreferences.getMediaAccessStatus("microphone"));
  });
  ipcMain.handle(IpcChannel.RequestAccessibilityPermission, () => {
    systemPreferences.isTrustedAccessibilityClient(true);
    const status = refreshPermissionStatus();
    if (status.accessibility !== "granted") {
      return status.accessibility;
    }
    return status.accessibility;
  });
  ipcMain.handle(IpcChannel.OpenPermissionSettings, (_e, permission: keyof PermissionStatus) => (
    openPermissionSettings(permission)
  ));
  ipcMain.handle(IpcChannel.RelaunchApp, () => {
    app.relaunch();
    app.quit();
  });

  ipcMain.handle(IpcChannel.SubmitAudioClip, (_e, payload: RecorderSubmission) => dictation.submitAudioClip(payload));
  ipcMain.handle(IpcChannel.RecorderReady, () => {
    recorder?.markReady();
    dictation.reportRecorderReady();
  });
  ipcMain.handle(IpcChannel.RecorderStarted, (_e, sessionId: string) => dictation.reportRecorderStarted(sessionId));
  ipcMain.handle(IpcChannel.ReportAudioFrame, (_e, frame: AudioVisualFrame) => dictation.updateAudioLevel(frame));
  ipcMain.handle(IpcChannel.RecorderFailure, (_e, payload: RecorderFailure) => dictation.handleRecorderFailure(payload));
  ipcMain.handle(IpcChannel.PrepareRecordingInput, () => nativeBridge.prepareRecordingInput?.() ?? null);
  ipcMain.handle(IpcChannel.RestoreRecordingInput, (_e, deviceId: number | null) => {
    if (typeof deviceId !== "number" || !Number.isFinite(deviceId)) return false;
    return nativeBridge.restoreRecordingInput?.(deviceId) ?? false;
  });

  // Phase 1: Provider API key testing
  ipcMain.handle(IpcChannel.TestApiKey, async (_e, providerId: string, apiKey: string) => {
    const registry = getProviderRegistry();
    return validateSubmittedApiKey(providerId, apiKey, (id) => registry.getTranscription(id) || registry.getFormatting(id));
  });

  ipcMain.handle(IpcChannel.GetProviderStatus, async () => {
    const registry = getProviderRegistry();
    const statuses = await registry.getProviderStatus();
    const currentSettings = settings.get();
    const providerApiKeys = currentSettings.providerApiKeys ?? [];

    return Promise.all(statuses.map(async (s) => ({
      id: s.id,
      name: s.name,
      available: s.available,
      configured: providerApiKeys.some(pk => pk.providerId === s.id && pk.key)
        || (s.id === "groq" && !!currentSettings.groqApiKey)
        || (credentials ? !!(await credentials.get(s.id)) : false),
      type: s.type,
    })));
  });

  // Capsule overlay: open last history entry for editing
  ipcMain.on("capsule:open-last-entry", async () => {
    const latest = await history.getLatest();
    if (latest) {
      dictation.navigateToHistoryEntry(latest.id);
    }
  });

  // Demo transcription (bypasses history and injection)
  ipcMain.handle(IpcChannel.DemoTranscribe, async (_e, clip) => {
    return dictation.demoTranscribe(clip);
  });

  // Manual update check
  ipcMain.handle(IpcChannel.CheckForUpdates, async () => {
    try {
      if (app.isPackaged) {
        const result = await autoUpdater.checkForUpdates();
        const latestVersion = result?.updateInfo?.version ?? "";
        const currentVersion = app.getVersion();
        const available = !!latestVersion && isNewerVersion(latestVersion, currentVersion);
        const version = latestVersion || currentVersion;
        if (available) {
          sendUpdateNotification({
            version,
            status: "available",
            message: `Vaani ${version} is available — download from GitHub`,
            installable: false,
          });
        } else {
          sendUpdateNotification({
            version,
            status: "no-update",
            message: "You're on the latest version",
          });
        }
        return { available, version };
      }
      // Development: check GitHub releases API
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let res: Response;
      try {
        res = await fetch("https://api.github.com/repos/Onkarj012/Vaani/releases/latest", {
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
      const data = await res.json() as { tag_name?: string };
      const latestVersion = (data.tag_name ?? "").replace(/^v/, "");
      const currentVersion = app.getVersion();
      const available = !!latestVersion && isNewerVersion(latestVersion, currentVersion);
      const version = latestVersion || currentVersion;
      if (available) {
        sendUpdateNotification({
          version,
          status: "available",
          message: `Vaani ${version} is available — download from GitHub`,
          installable: false,
        });
      } else {
        sendUpdateNotification({
          version,
          status: "no-update",
          message: "You're on the latest version",
        });
      }
      return { available, version };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { available: false, version: app.getVersion() };
      }
      const message = err instanceof Error ? err.message : "Update check failed";
      sendUpdateNotification({
        status: "error",
        message,
      });
      throw new Error(message);
    }
  });

  ipcMain.handle(IpcChannel.GetAppVersion, () => app.getVersion());

  ipcMain.handle(IpcChannel.GetUpdateStatus, () => cachedUpdateStatus);

  ipcMain.on(IpcChannel.QuitAndInstall, () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.on(IpcChannel.OpenReleasesPage, () => {
    void shell.openExternal("https://github.com/Onkarj012/Vaani/releases/latest");
  });

  // Local Whisper model management
  ipcMain.handle(IpcChannel.WhisperListModels, () => {
    const modelsDir = join(homedir(), ".vaani", "models");
    return listDownloadedModels(modelsDir);
  });

  ipcMain.handle(IpcChannel.WhisperLoadModel, (_e, modelName: string) => {
    assertValidWhisperModelName(modelName);
    const modelsDir = join(homedir(), ".vaani", "models");
    const modelPath = join(modelsDir, `ggml-${modelName}.bin`);
    return loadWhisperModel(modelPath);
  });

  ipcMain.handle(IpcChannel.WhisperFreeModel, () => {
    freeWhisperModel();
  });

  ipcMain.handle(IpcChannel.WhisperIsModelLoaded, () => {
    return isModelLoaded();
  });
}
