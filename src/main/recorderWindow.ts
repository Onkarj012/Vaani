import { BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IpcChannel } from "@shared/ipc";
import type { RecorderConfig } from "@shared/types";

declare const RECORDER_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const RECORDER_WINDOW_VITE_NAME: string;

const currentDir = dirname(fileURLToPath(import.meta.url));

export class RecorderWindowController {
  private window: BrowserWindow | null = null;
  private ready = false;
  private pendingCommand: { channel: IpcChannel.StartRecording | IpcChannel.StopRecording; sessionId: string } | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly getConfig: () => RecorderConfig = () => ({ preWarmMic: true })) {}

  isReady(): boolean {
    return this.ready && !!this.window && !this.window.isDestroyed();
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

    win.on("closed", () => {
      if (this.window === win) {
        this.window = null;
      }
      this.ready = false;
      this.pendingCommand = null;
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
  }

  startRecording(sessionId: string): boolean {
    return this.sendOrQueue(IpcChannel.StartRecording, sessionId);
  }

  stopRecording(sessionId: string): boolean {
    return this.sendOrQueue(IpcChannel.StopRecording, sessionId);
  }

  updateConfig(config: RecorderConfig): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    this.window.webContents.send(IpcChannel.RecorderConfigChanged, config);
  }

  destroy(): void {
    this.ready = false;
    this.pendingCommand = null;
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

  private send(channel: IpcChannel.StartRecording | IpcChannel.StopRecording, sessionId: string): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    this.window.webContents.send(channel, { sessionId, config: this.getConfig() });
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
