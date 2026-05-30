import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel } from "@shared/ipc";
import type { DictionarySuggestion } from "@shared/dictionarySuggestions";
import type { DictationState, UpdateNotificationPayload, VaaniAPI } from "@shared/types";

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
  getPermissionStatus: () => ipcRenderer.invoke(IpcChannel.GetPermissionStatus),
  requestMicrophonePermission: () => ipcRenderer.invoke(IpcChannel.RequestMicrophonePermission),
  requestAccessibilityPermission: () => ipcRenderer.invoke(IpcChannel.RequestAccessibilityPermission),
  openPermissionSettings: (permission) => ipcRenderer.invoke(IpcChannel.OpenPermissionSettings, permission),
  onNavigate: (cb) => subscribe<{ route: string }>(IpcChannel.Navigation, ({ route }) => cb(route)),
  onUpdateNotification: (cb) => subscribe<UpdateNotificationPayload>(IpcChannel.UpdateNotification, cb),
  checkForUpdates: () => ipcRenderer.invoke(IpcChannel.CheckForUpdates),
  quitAndInstall: () => ipcRenderer.send(IpcChannel.QuitAndInstall),
  restartAndInstall: async () => {
    ipcRenderer.send(IpcChannel.QuitAndInstall);
  },
  getAppVersion: () => ipcRenderer.invoke(IpcChannel.GetAppVersion),
  demoTranscribe: (clip) => ipcRenderer.invoke(IpcChannel.DemoTranscribe, clip),
  reportRendererReady: () => ipcRenderer.send(IpcChannel.RendererReady),
  reportRendererError: (payload) => ipcRenderer.send(IpcChannel.RendererError, payload),
  testApiKey: (providerId, apiKey) => ipcRenderer.invoke(IpcChannel.TestApiKey, providerId, apiKey),
  getProviderStatus: () => ipcRenderer.invoke(IpcChannel.GetProviderStatus),
  whisperListModels: () => ipcRenderer.invoke(IpcChannel.WhisperListModels),
  whisperLoadModel: (modelName) => ipcRenderer.invoke(IpcChannel.WhisperLoadModel, modelName),
  whisperFreeModel: () => ipcRenderer.invoke(IpcChannel.WhisperFreeModel),
  whisperIsModelLoaded: () => ipcRenderer.invoke(IpcChannel.WhisperIsModelLoaded),
};

contextBridge.exposeInMainWorld("vaani", api);
