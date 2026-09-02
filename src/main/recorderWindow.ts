import { BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IpcChannel } from "@shared/ipc";
import type { RecorderConfig, RecorderSuspensionAck } from "@shared/types";
import type { CaptureResumeResult, CaptureSuspendResult } from "./audio/nativeCapture";

declare const RECORDER_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const RECORDER_WINDOW_VITE_NAME: string;

const currentDir = dirname(fileURLToPath(import.meta.url));
const LIFECYCLE_SUSPEND_TIMEOUT_MS = 1_500;

export class RecorderWindowController {
  private window: BrowserWindow | null = null;
  private ready = false;
  private pendingCommand: { channel: IpcChannel.StartRecording | IpcChannel.StopRecording; sessionId: string } | null = null;
  private activeSessionId: string | null = null;
  private lifecycleResumePending = false;
  private initPromise: Promise<void> | null = null;
  private pendingLifecycleSuspension: {
    sessionId: string;
    resolve: (result: CaptureSuspendResult) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(private readonly getConfig: () => RecorderConfig = () => ({ preWarmMic: false })) {}

  isReady(): boolean {
    return this.ready && !!this.window && !this.window.isDestroyed();
  }

  getWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  async init(): Promise<void> {
    if (this.window && !this.window.isDestroyed()) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.createWindow().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async createWindow(): Promise<void> {
    this.ready = false;
    const win = new BrowserWindow({
      width: 320,
      height: 180,
      show: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        preload: join(currentDir, "recorder-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });
    this.window = win;

    win.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    win.on("closed", () => {
      const closedSessionId = this.activeSessionId;
      this.resolveLifecycleSuspension({ wasRunning: closedSessionId !== null, sessionId: closedSessionId, recordingResumed: false });
      if (this.window === win) {
        this.window = null;
      }
      this.ready = false;
      this.pendingCommand = null;
      this.activeSessionId = null;
      this.lifecycleResumePending = false;
    });

    win.on("unresponsive", () => {
      this.ready = false;
      win.webContents.forcefullyCrashRenderer();
      this.recover();
    });

    win.webContents.on("did-start-loading", () => {
      this.ready = false;
    });

    win.webContents.on("did-fail-load", () => {
      this.ready = false;
      this.recover();
    });

    win.webContents.on("render-process-gone", () => {
      this.ready = false;
      this.recover();
    });

    if (typeof RECORDER_WINDOW_VITE_DEV_SERVER_URL !== "undefined") {
      await win.loadURL(RECORDER_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      await win.loadFile(join(currentDir, `../renderer/${RECORDER_WINDOW_VITE_NAME}/index.html`));
    }
  }

  markReady(): void {
    this.ready = true;
    if (this.pendingCommand) {
      const { channel, sessionId } = this.pendingCommand;
      this.pendingCommand = null;
      this.send(channel, sessionId);
    }
    if (this.lifecycleResumePending) {
      this.lifecycleResumePending = false;
      this.send(IpcChannel.ResumeRecording, this.activeSessionId ?? "lifecycle");
    }
  }

  startRecording(sessionId: string): boolean {
    this.activeSessionId = sessionId;
    return this.sendOrQueue(IpcChannel.StartRecording, sessionId);
  }

  stopRecording(sessionId: string): boolean {
    return this.sendOrQueue(IpcChannel.StopRecording, sessionId);
  }

  abortRecording(sessionId: string): void {
    if (this.pendingCommand?.channel === IpcChannel.StartRecording && this.pendingCommand.sessionId === sessionId) {
      this.pendingCommand = null;
    }
    if (this.activeSessionId === sessionId) this.activeSessionId = null;
    if (this.isReady()) this.send(IpcChannel.AbortRecording, sessionId);
  }

  suspendForLifecycle(): CaptureSuspendResult | Promise<CaptureSuspendResult> {
    const sessionId = this.activeSessionId;
    if (!sessionId) return { wasRunning: false, sessionId: null, recordingResumed: true };
    if (!this.isReady()) return { wasRunning: true, sessionId, recordingResumed: false };
    if (this.pendingLifecycleSuspension?.sessionId === sessionId) {
      return new Promise<CaptureSuspendResult>((resolve) => {
        const pending = this.pendingLifecycleSuspension;
        if (!pending) return;
        const priorResolve = pending.resolve;
        pending.resolve = (result) => { priorResolve(result); resolve(result); };
      });
    }
    const result = new Promise<CaptureSuspendResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingLifecycleSuspension?.sessionId !== sessionId) return;
        this.pendingLifecycleSuspension = null;
        resolve({ wasRunning: true, sessionId, recordingResumed: false });
      }, LIFECYCLE_SUSPEND_TIMEOUT_MS);
      this.pendingLifecycleSuspension = { sessionId, resolve, timer };
    });
    this.send(IpcChannel.SuspendRecording, sessionId);
    return result;
  }

  acknowledgeLifecycleSuspension(ack: RecorderSuspensionAck): boolean {
    if (this.pendingLifecycleSuspension?.sessionId !== ack.sessionId) return false;
    this.resolveLifecycleSuspension({
      wasRunning: true,
      sessionId: ack.sessionId,
      recordingResumed: false,
      ...(ack.ok && ack.partialClip ? { partialClip: ack.partialClip } : {}),
    });
    return true;
  }

  resumeAfterLifecycle(): CaptureResumeResult {
    if (!this.isReady()) {
      this.lifecycleResumePending = true;
      void this.init();
      return { ok: false, selectedDeviceUid: null, message: "Renderer capture is not ready." };
    }
    this.send(IpcChannel.ResumeRecording, this.activeSessionId ?? "lifecycle");
    return { ok: true, selectedDeviceUid: null };
  }

  updateConfig(config: RecorderConfig): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    this.window.webContents.send(IpcChannel.RecorderConfigChanged, config);
  }

  destroy(): void {
    const destroyedSessionId = this.activeSessionId;
    this.resolveLifecycleSuspension({ wasRunning: destroyedSessionId !== null, sessionId: destroyedSessionId, recordingResumed: false });
    this.ready = false;
    this.pendingCommand = null;
    this.activeSessionId = null;
    this.lifecycleResumePending = false;
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
  }

  private sendOrQueue(channel: IpcChannel.StartRecording | IpcChannel.StopRecording, sessionId: string): boolean {
    if (!this.isReady()) {
      // Don't overwrite a pending start with a stop — the recorder hasn't even
      // started yet, so a stop would be meaningless and would leave the session
      // stuck. Drop the stop; the recorder will fail/timeout naturally.
      if (channel === IpcChannel.StopRecording && this.pendingCommand?.channel === IpcChannel.StartRecording) {
        return true;
      }
      this.pendingCommand = { channel, sessionId };
      void this.init();
      return true;
    }

    this.send(channel, sessionId);
    return true;
  }

  private send(channel: IpcChannel.StartRecording | IpcChannel.StopRecording | IpcChannel.AbortRecording | IpcChannel.SuspendRecording | IpcChannel.ResumeRecording, sessionId: string): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    this.window.webContents.send(channel, { sessionId, config: this.getConfig() });
  }

  private resolveLifecycleSuspension(result: CaptureSuspendResult): void {
    const pending = this.pendingLifecycleSuspension;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingLifecycleSuspension = null;
    pending.resolve(result);
  }

  private recover(): void {
    if (!this.window || this.window.isDestroyed()) {
      void this.init();
      return;
    }

    try {
      this.window.reload();
    } catch {
      this.window.destroy();
      this.window = null;
      void this.init();
    }
  }
}
