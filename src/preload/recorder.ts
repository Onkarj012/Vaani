import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel } from "@shared/ipc";
import type { AudioVisualFrame, RecorderCommand, RecorderFailure, RecorderSubmission } from "@shared/types";

function subscribe<T>(channel: IpcChannel, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("__VAANI_RECORDER__", {
  onStartRecording: (cb: (payload: RecorderCommand) => void) => subscribe<RecorderCommand>(IpcChannel.StartRecording, cb),
  onStopRecording: (cb: (payload: RecorderCommand) => void) => subscribe<RecorderCommand>(IpcChannel.StopRecording, cb),
  submitAudioClip: (payload: RecorderSubmission) => ipcRenderer.invoke(IpcChannel.SubmitAudioClip, payload),
  reportRecorderReady: () => ipcRenderer.invoke(IpcChannel.RecorderReady),
  reportRecorderStarted: (sessionId: string) => ipcRenderer.invoke(IpcChannel.RecorderStarted, sessionId),
  reportAudioFrame: (frame: AudioVisualFrame) => ipcRenderer.invoke(IpcChannel.ReportAudioFrame, frame),
  reportRecorderFailure: (payload: RecorderFailure) => ipcRenderer.invoke(IpcChannel.RecorderFailure, payload),
  prepareRecordingInput: () => ipcRenderer.invoke(IpcChannel.PrepareRecordingInput),
  restoreRecordingInput: (deviceId: number | null) => ipcRenderer.invoke(IpcChannel.RestoreRecordingInput, deviceId)
});
