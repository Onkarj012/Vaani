import { BrowserWindow, ipcMain } from "electron";
import { IpcChannel } from "@shared/ipc";
import type { DictionarySuggestion } from "@shared/dictionarySuggestions";
import type { AudioVisualFrame, RecorderFailure, RecorderSubmission, Settings } from "@shared/types";
import { DictationService } from "./dictation";
import { HistoryStore } from "./store/history";
import { SettingsStore } from "./store/settings";
import { HotkeyManager } from "./hotkeys";
import { nativeBridge } from "./nativeBridge";
import { RecorderWindowController } from "./recorderWindow";

export function registerIpcHandlers(opts: {
  mainWindow: BrowserWindow | null;
  dictation: DictationService;
  history: HistoryStore;
  settings: SettingsStore;
  hotkeys: HotkeyManager;
  recorder?: RecorderWindowController;
  onSettingsUpdated?: (settings: Settings, patch: Partial<Settings>) => void;
}): void {
  const { dictation, history, settings, hotkeys, recorder, onSettingsUpdated } = opts;

  ipcMain.handle(IpcChannel.GetDictationState, () => dictation.getState());
  ipcMain.handle(IpcChannel.GetHistory,      ()            => history.getAll());
  ipcMain.handle(IpcChannel.UpdateHistoryEntry, (_e, id: string, cleanedText: string) => history.updateById(id, (entry) => ({
    ...entry,
    cleanedText
  })));
  ipcMain.handle(IpcChannel.ReinjectEntry,   (_e, id: string) => dictation.reinjectEntry(id));
  ipcMain.handle(IpcChannel.DeleteEntry,     (_e, id: string) => history.delete(id));
  ipcMain.handle(IpcChannel.ClearHistory,    ()            => history.clear());
  ipcMain.handle(IpcChannel.GetSettings,     ()            => settings.get());

  ipcMain.handle(IpcChannel.UpdateSettings,  (_e, patch) => {
    const updated = settings.update(patch);
    // Re-register hotkeys if combo changed
    if ("primaryHotkey" in patch || "pasteLatestHotkey" in patch) {
      hotkeys.reregister();
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
    if (typeof deviceId !== "number" || !Number.isFinite(deviceId)) {
      return false;
    }
    return nativeBridge.restoreRecordingInput?.(deviceId) ?? false;
  });
}
