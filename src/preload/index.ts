import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel } from "@shared/ipc";
import type { DictionarySuggestion } from "@shared/dictionarySuggestions";
import type { DictationState, VaaniAPI } from "@shared/types";

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
  copyText: (text) => ipcRenderer.invoke(IpcChannel.CopyText, text),
  getSettings: () => ipcRenderer.invoke(IpcChannel.GetSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IpcChannel.UpdateSettings, patch),
  setHotkeyCapture: (active) => ipcRenderer.invoke(IpcChannel.SetHotkeyCapture, active),
  showDictionaryPrompt: (suggestions: DictionarySuggestion[]) => ipcRenderer.invoke(IpcChannel.ShowDictionaryPrompt, suggestions),
  onNavigate: (cb) => subscribe<{ route: string }>(IpcChannel.Navigation, ({ route }) => cb(route)),
  reportRendererReady: () => ipcRenderer.send(IpcChannel.RendererReady),
  reportRendererError: (payload) => ipcRenderer.send(IpcChannel.RendererError, payload)
};

contextBridge.exposeInMainWorld("vaani", api);
