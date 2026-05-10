import { BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IpcChannel } from "@shared/ipc";

declare const RECORDER_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const RECORDER_WINDOW_VITE_NAME: string;

const currentDir = dirname(fileURLToPath(import.meta.url));

export class RecorderWindowController {
  private window: BrowserWindow | null = null;
  private ready = false;
  private pendingCommand: { channel: IpcChannel.StartRecording | IpcChannel.StopRecording; sessionId: string } | null = null;

  isReady(): boolean {
    return this.ready && !!this.window && !this.window.isDestroyed();
  }

  async init(): Promise<void> {
    if (this.window && !this.window.isDestroyed()) {
      return;
    }

    this.ready = false;
    this.window = new BrowserWindow({
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

    this.window.on("closed", () => {
      this.window = null;
      this.ready = false;
      this.pendingCommand = null;
    });

    if (typeof RECORDER_WINDOW_VITE_DEV_SERVER_URL !== "undefined") {
      await this.window.loadURL(RECORDER_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      await this.window.loadFile(join(currentDir, `../renderer/${RECORDER_WINDOW_VITE_NAME}/index.html`));
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
      this.pendingCommand = { channel, sessionId };
      return false;
    }

    this.send(channel, sessionId);
    return true;
  }

  private send(channel: IpcChannel.StartRecording | IpcChannel.StopRecording, sessionId: string): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    this.window.webContents.send(channel, { sessionId });
  }
}
