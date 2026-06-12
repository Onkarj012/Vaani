import { app, BrowserWindow, clipboard, ipcMain, shell, systemPreferences } from "electron";
import { autoUpdater } from "electron-updater";
import { IpcChannel } from "@shared/ipc";
import { KNOWN_PROVIDERS } from "@shared/defaults";
import type { DictionarySuggestion } from "@shared/dictionarySuggestions";
import type {
  AudioVisualFrame,
  MacOSPermissionState,
  PermissionStatus,
  RecorderFailure,
  RecorderSubmission,
  Settings
} from "@shared/types";
import { DictationService } from "./dictation";
import { HistoryStore } from "./store/history";
import { SettingsStore } from "./store/settings";
import { CredentialsStore } from "./store/credentials";
import { HotkeyManager } from "./hotkeys";
import { nativeBridge } from "./nativeBridge";
import { RecorderWindowController } from "./recorderWindow";
import { getProviderRegistry } from "./providers";
import { detectDictionarySuggestions } from "@shared/dictionarySuggestions";
import { cachedUpdateStatus } from "./index";

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
  const accessibilityTrusted = nativeBridge.isAccessibilityTrusted?.()
    ?? systemPreferences.isTrustedAccessibilityClient(false);

  return {
    microphone: normalizeMediaStatus(systemPreferences.getMediaAccessStatus("microphone")),
    accessibility: accessibilityTrusted ? "granted" : "denied"
  };
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
  ipcMain.handle(IpcChannel.GetSettings, () => settings.get());

  ipcMain.handle(IpcChannel.UpdateSettings, (_e, patch) => {
    if ("formattingProvider" in patch && typeof patch.formattingProvider === "string" && !("formattingModel" in patch)) {
      const provider = KNOWN_PROVIDERS.find((candidate) => candidate.id === patch.formattingProvider);
      if (provider?.type === "llm") {
        patch = { ...patch, formattingModel: provider.defaultModel };
      }
    }

    const updated = settings.update(patch);
    if ("primaryHotkey" in patch || "pasteLatestHotkey" in patch) {
      hotkeys.reregister();
    }
    // Keep in-memory credentials cache in sync with saved API keys
    if (credentials) {
      const allKeys = new Set<string>();
      for (const pk of updated.providerApiKeys ?? []) {
        if (pk.providerId && pk.key) {
          credentials.set(pk.providerId, pk.key);
        }
        allKeys.add(pk.providerId);
      }
      if (updated.groqApiKey) {
        credentials.set("groq", updated.groqApiKey);
        allKeys.add("groq");
      }
      // Remove credentials that are no longer present in settings
      for (const entry of credentials.getAll()) {
        if (!allKeys.has(entry.key)) {
          credentials.delete(entry.key);
        }
      }
    }
    // Update provider registry when provider or key settings change
    if ("transcriptionProvider" in patch) {
      getProviderRegistry().setActiveTranscription(updated.transcriptionProvider);
    }
    if ("formattingProvider" in patch) {
      getProviderRegistry().setActiveFormatting(updated.formattingProvider);
    }
    onSettingsUpdated?.(updated, patch);
    return updated;
  });
  ipcMain.handle(IpcChannel.SetHotkeyCapture, (_e, active: boolean) => {
    hotkeys.setCaptureActive(active);
  });
  ipcMain.handle(IpcChannel.ShowDictionaryPrompt, (_e, suggestions: DictionarySuggestion[]) => (
    dictation.showDictionarySuggestions(suggestions)
  ));
  ipcMain.handle(IpcChannel.GetPermissionStatus, () => getPermissionStatus());
  ipcMain.handle(IpcChannel.RequestMicrophonePermission, async () => {
    await systemPreferences.askForMediaAccess("microphone");
    return normalizeMediaStatus(systemPreferences.getMediaAccessStatus("microphone"));
  });
  ipcMain.handle(IpcChannel.RequestAccessibilityPermission, () => {
    systemPreferences.isTrustedAccessibilityClient(true);
    const trusted = nativeBridge.isAccessibilityTrusted?.()
      ?? systemPreferences.isTrustedAccessibilityClient(false);
    return trusted ? "granted" : "denied";
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
  ipcMain.handle(IpcChannel.TestApiKey, async (_e, providerId: string, _apiKey: string) => {
    try {
      const registry = getProviderRegistry();
      const provider = registry.getTranscription(providerId) || registry.getFormatting(providerId);
      if (!provider) return { valid: false, message: `Provider "${providerId}" not found.` };

      const available = await provider.isAvailable();
      return { valid: available, message: available ? `${provider.name} is available.` : `${provider.name} is not available.` };
    } catch (error) {
      return { valid: false, message: error instanceof Error ? error.message : "Test failed." };
    }
  });

  ipcMain.handle(IpcChannel.GetProviderStatus, async () => {
    const registry = getProviderRegistry();
    const statuses = await registry.getProviderStatus();
    const currentSettings = settings.get();
    const providerApiKeys = currentSettings.providerApiKeys ?? [];

    return statuses.map(s => ({
      id: s.id,
      name: s.name,
      available: s.available,
      configured: providerApiKeys.some(pk => pk.providerId === s.id && pk.key)
        || (s.id === "groq" && !!currentSettings.groqApiKey)
        || (credentials ? !!credentials.get(s.id) : false),
      type: s.type,
    }));
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
          mainWindow?.webContents.send(IpcChannel.UpdateNotification, {
            version,
            status: "downloading",
            message: `Update ${version} downloading…`,
          });
        } else {
          mainWindow?.webContents.send(IpcChannel.UpdateNotification, {
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
      if (!available) {
        mainWindow?.webContents.send(IpcChannel.UpdateNotification, {
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
      mainWindow?.webContents.send(IpcChannel.UpdateNotification, {
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
}
