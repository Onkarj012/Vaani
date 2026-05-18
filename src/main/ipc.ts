import { BrowserWindow, clipboard, ipcMain, shell, systemPreferences } from "electron";
import { IpcChannel } from "@shared/ipc";
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
  return {
    microphone: normalizeMediaStatus(systemPreferences.getMediaAccessStatus("microphone")),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "denied"
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
  const { dictation, history, settings, hotkeys, recorder, credentials, onSettingsUpdated } = opts;

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
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    return trusted ? "granted" : "denied";
  });
  ipcMain.handle(IpcChannel.OpenPermissionSettings, (_e, permission: keyof PermissionStatus) => (
    openPermissionSettings(permission)
  ));

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
}
