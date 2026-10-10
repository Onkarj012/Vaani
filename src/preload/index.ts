import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel } from "@shared/ipc";
import { assertValidWhisperModelName } from "@shared/whisperModels";
import type { DictionarySuggestion } from "@shared/dictionarySuggestions";
import type { AudioInputDevice, DictationState, PermissionStatus, UpdateNotificationPayload, VaaniAPI } from "@shared/types";

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
  retryHistoryEntry: (id) => ipcRenderer.invoke(IpcChannel.RetryHistoryEntry, id),
  getRecoveryReadiness: () => ipcRenderer.invoke(IpcChannel.GetRecoveryReadiness),
  getRecoveryEntries: () => ipcRenderer.invoke(IpcChannel.GetRecoveryEntries),
  retryRecoveryTranscription: (id) => ipcRenderer.invoke(IpcChannel.RetryRecoveryTranscription, id),
  retryRecoveryFormatting: (id) => ipcRenderer.invoke(IpcChannel.RetryRecoveryFormatting, id),
  useRawRecoveryTranscript: (id) => ipcRenderer.invoke(IpcChannel.UseRawRecoveryTranscript, id),
  retryRecoveryInsertion: (id) => ipcRenderer.invoke(IpcChannel.RetryRecoveryInsertion, id),
  copyRecoveryEntry: (id) => ipcRenderer.invoke(IpcChannel.CopyRecoveryEntry, id),
  playRecoveryAudio: (id) => ipcRenderer.invoke(IpcChannel.PlayRecoveryAudio, id),
  deleteRecoveryAudio: (id) => ipcRenderer.invoke(IpcChannel.DeleteRecoveryAudio, id),
  discardRecoveryEntry: (id) => ipcRenderer.invoke(IpcChannel.DiscardRecoveryEntry, id),
  getRecoveryStorageUsage: () => ipcRenderer.invoke(IpcChannel.GetRecoveryStorageUsage),
  cleanupRecoveryAudio: () => ipcRenderer.invoke(IpcChannel.CleanupRecoveryAudio),
  clearRecoveryAudio: () => ipcRenderer.invoke(IpcChannel.ClearRecoveryAudio),
  getRecoveryRestoredNotice: () => ipcRenderer.invoke(IpcChannel.GetRecoveryRestored),
  getDictationTrace: (traceId) => ipcRenderer.invoke(IpcChannel.GetDictationTrace, traceId),
  exportBugReport: (entryId) => ipcRenderer.invoke(IpcChannel.ExportBugReport, entryId),
  clearHistory: () => ipcRenderer.invoke(IpcChannel.ClearHistory),
  copyText: (text) => ipcRenderer.invoke(IpcChannel.CopyText, text),
  getSettings: () => ipcRenderer.invoke(IpcChannel.GetSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IpcChannel.UpdateSettings, patch),
  setHotkeyCapture: (active) => ipcRenderer.invoke(IpcChannel.SetHotkeyCapture, active),
  showDictionaryPrompt: (suggestions: DictionarySuggestion[]) => ipcRenderer.invoke(IpcChannel.ShowDictionaryPrompt, suggestions),
  purgeAutoSuggestedCorrections: () => ipcRenderer.invoke(IpcChannel.PurgeAutoSuggestedCorrections),
  getPermissionStatus: () => ipcRenderer.invoke(IpcChannel.GetPermissionStatus),
  listAudioInputDevices: () => ipcRenderer.invoke(IpcChannel.ListAudioInputDevices) as Promise<AudioInputDevice[]>,
  requestMicrophonePermission: () => ipcRenderer.invoke(IpcChannel.RequestMicrophonePermission),
  requestAccessibilityPermission: () => ipcRenderer.invoke(IpcChannel.RequestAccessibilityPermission),
  openPermissionSettings: (permission) => ipcRenderer.invoke(IpcChannel.OpenPermissionSettings, permission),
  onPermissionStatusChanged: (cb) => subscribe<PermissionStatus>(IpcChannel.PermissionStatusPush, cb),
  relaunchApp: () => ipcRenderer.invoke(IpcChannel.RelaunchApp),
  onNavigate: (cb) => subscribe<{ route: string }>(IpcChannel.Navigation, ({ route }) => cb(route)),
  onUpdateNotification: (cb) => subscribe<UpdateNotificationPayload>(IpcChannel.UpdateNotification, cb),
  getUpdateStatus: () => ipcRenderer.invoke(IpcChannel.GetUpdateStatus),
  checkForUpdates: () => ipcRenderer.invoke(IpcChannel.CheckForUpdates),
  quitAndInstall: () => ipcRenderer.send(IpcChannel.QuitAndInstall),
  openReleasesPage: () => ipcRenderer.send(IpcChannel.OpenReleasesPage),
  restartAndInstall: async () => {
    ipcRenderer.send(IpcChannel.QuitAndInstall);
  },
  getAppVersion: () => ipcRenderer.invoke(IpcChannel.GetAppVersion),
  demoTranscribe: (clip) => ipcRenderer.invoke(IpcChannel.DemoTranscribe, clip),
  reportRendererReady: () => ipcRenderer.send(IpcChannel.RendererReady),
  reportRendererError: (payload) => ipcRenderer.send(IpcChannel.RendererError, payload),
  testApiKey: (providerId, apiKey) => ipcRenderer.invoke(IpcChannel.TestApiKey, providerId, apiKey),
  setProviderApiKey: (providerId, apiKey) => ipcRenderer.invoke(IpcChannel.SetProviderApiKey, providerId, apiKey),
  clearProviderApiKey: (providerId) => ipcRenderer.invoke(IpcChannel.ClearProviderApiKey, providerId),
  getProviderStatus: () => ipcRenderer.invoke(IpcChannel.GetProviderStatus),
  whisperListModels: () => ipcRenderer.invoke(IpcChannel.WhisperListModels),
  whisperLoadModel: (modelName) => {
    assertValidWhisperModelName(modelName);
    return ipcRenderer.invoke(IpcChannel.WhisperLoadModel, modelName);
  },
  whisperFreeModel: () => ipcRenderer.invoke(IpcChannel.WhisperFreeModel),
  whisperIsModelLoaded: () => ipcRenderer.invoke(IpcChannel.WhisperIsModelLoaded),
};

contextBridge.exposeInMainWorld("vaani", api);
