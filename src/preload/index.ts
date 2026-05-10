import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel } from "@shared/ipc";
import type { DictionarySuggestion } from "@shared/dictionarySuggestions";
import type { AudioVisualFrame, DictationState, RecorderFailure, RecorderSubmission, VaaniAPI } from "@shared/types";

function subscribe<T>(channel: IpcChannel, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: VaaniAPI = {
  getDictationState: () => ipcRenderer.invoke(IpcChannel.GetDictationState),
  onStateChange: (cb) => subscribe<DictationState>(IpcChannel.DictationState, cb),
  onAudioLevel: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, level: number, bars?: number[]) => cb(level, bars);
    ipcRenderer.on(IpcChannel.AudioLevel, listener);
    return () => ipcRenderer.removeListener(IpcChannel.AudioLevel, listener);
  },
  getHistory: () => ipcRenderer.invoke(IpcChannel.GetHistory),
  updateHistoryEntry: (id, cleanedText) => ipcRenderer.invoke(IpcChannel.UpdateHistoryEntry, id, cleanedText),
  deleteEntry: (id) => ipcRenderer.invoke(IpcChannel.DeleteEntry, id),
  reinjectEntry: (id) => ipcRenderer.invoke(IpcChannel.ReinjectEntry, id),
  clearHistory: () => ipcRenderer.invoke(IpcChannel.ClearHistory),
  getSettings: () => ipcRenderer.invoke(IpcChannel.GetSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IpcChannel.UpdateSettings, patch),
  setHotkeyCapture: (active) => ipcRenderer.invoke(IpcChannel.SetHotkeyCapture, active),
  showDictionaryPrompt: (suggestions: DictionarySuggestion[]) => ipcRenderer.invoke(IpcChannel.ShowDictionaryPrompt, suggestions),
  onNavigate: (cb) => subscribe<{ route: string }>(IpcChannel.Navigation, ({ route }) => cb(route))
};

const recorderApi = {
  submitAudioClip: (payload: RecorderSubmission) => ipcRenderer.invoke(IpcChannel.SubmitAudioClip, payload),
  reportRecorderReady: () => ipcRenderer.invoke(IpcChannel.RecorderReady),
  reportAudioFrame: (frame: AudioVisualFrame) => ipcRenderer.invoke(IpcChannel.ReportAudioFrame, frame),
  reportRecorderFailure: (payload: RecorderFailure) => ipcRenderer.invoke(IpcChannel.RecorderFailure, payload),
  prepareRecordingInput: () => ipcRenderer.invoke(IpcChannel.PrepareRecordingInput),
  restoreRecordingInput: (deviceId: number | null) => ipcRenderer.invoke(IpcChannel.RestoreRecordingInput, deviceId)
};

contextBridge.exposeInMainWorld("vaani", api);
contextBridge.exposeInMainWorld("__VAANI_RECORDER__", recorderApi);
