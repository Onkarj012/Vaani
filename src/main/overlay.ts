import { app, BrowserWindow } from "electron";
import { nativeBridge } from "./nativeBridge";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);

declare const OVERLAY_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const OVERLAY_WINDOW_VITE_NAME: string;

const _dir = dirname(fileURLToPath(import.meta.url));

const CAPSULE_BOTTOM_MARGIN = 24;
// Non-prompt: fits the recording waveform pill (9 bars × 5px + padding)
const PILL_W = 120;
const PILL_H = 52;
// Prompt card: matches CapsuleOverlay.tsx prompt width (340px) + shadow clearance
const PROMPT_W = 360;
const PROMPT_H = 210;

export class OverlayController {
  private window: BrowserWindow | null = null;
  private loadReady = false;
  private pendingMode: "idle" | "pressed" | "recording" | "transcribing" | "done" | "error" | null = null;
  private pendingBars: number[] | null = null;
  private promptActive = false;
  private promptDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private accentColor = "#FF006E";

  // ── Public setters ────────────────────────────────────────────────────────

  setColorMode(_colorMode: "light" | "dark"): void {
    // Overlay is always dark — no-op kept for call-site compatibility
  }

  setAccentColor(color: string): void {
    this.accentColor = color;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("capsule:set-accent", color);
    }
  }

  setCapsuleStyle(_opts: { borderWidth?: number; barRadius?: number; cornerRadius?: number }): void {
    // Visual style is handled by the React renderer — no-op
  }

  setCapsuleDesign(_design: "dot" | "bar" | "rule" | "pill"): void {
    // All designs now use the unified React renderer — no-op
  }

  setTheme(_theme: "aurora"): void {
    // no-op
  }

  // ── Visibility / state ───────────────────────────────────────────────────

  prewarm(): void {
    if (this.window && !this.window.isDestroyed()) return;
    this.loadReady = false;
    void this.createWindow();
  }

  show(): void {
    const frontmostBefore = nativeBridge.getFrontmostApplication?.();
    if (this.window && !this.window.isDestroyed()) {
      this.window.showInactive();
      void this.restoreFocusIfNeeded(frontmostBefore);
      return;
    }
    this.loadReady = false;
    void this.createWindow().then(() => {
      this.window?.showInactive();
      void this.restoreFocusIfNeeded(frontmostBefore);
    });
  }

  hide(): void {
    if (this.promptActive) return;
    if (this.window && !this.window.isDestroyed()) {
      this.tryUpdateMode("idle");
      this.window.hide();
    }
    this.pendingMode = null;
    this.pendingBars = null;
  }

  setRecording(): void {
    this.pendingMode = "recording";
    this.pendingBars = null;
    this.show();
    this.tryUpdateMode("recording");
  }

  setPressed(): void {
    this.pendingMode = "pressed";
    this.pendingBars = null;
    this.show();
    this.tryUpdateMode("pressed");
  }

  setProcessing(): void {
    this.pendingMode = "transcribing";
    this.tryUpdateMode("transcribing");
  }

  setSuccess(): void {
    this.pendingMode = "done";
    this.tryUpdateMode("done");
  }

  setError(): void {
    this.pendingMode = "error";
    this.tryUpdateMode("error");
  }

  updateBars(bars: number[]): void {
    this.pendingBars = bars;
    if (!this.loadReady || !this.window || this.window.isDestroyed()) return;
    if (this.pendingMode === "pressed") {
      this.pendingMode = "recording";
      this.window.webContents.send("capsule:set-mode", "recording");
    }
    this.window.webContents.send("capsule:update-bars", bars);
  }

  // ── Prompts ──────────────────────────────────────────────────────────────

  showSnippetPrompt(trigger: string, onResponse: (accepted: boolean) => void): void {
    this.promptActive = true;
    this.clearPromptDismissTimer();
    this.show();

    const showUI = async () => {
      if (!this.window || this.window.isDestroyed()) return;
      await this.resizeWindow(true);
      this.window.setIgnoreMouseEvents(false);
      this.window.setFocusable(true);
      this.window.focus();
      this.window.webContents.send("capsule:show-snippet", { trigger });
      this.promptDismissTimer = setTimeout(() => {
        this.endPrompt();
        onResponse(false);
      }, 8000);
    };

    if (this.loadReady) {
      void showUI();
    } else {
      const check = setInterval(() => {
        if (this.loadReady) { clearInterval(check); void showUI(); }
      }, 50);
      setTimeout(() => clearInterval(check), 5000);
    }

    this.window?.webContents.ipc.once("capsule:snippet-response", (_e, args: { accepted: boolean }) => {
      this.clearPromptDismissTimer();
      this.endPrompt();
      onResponse(args.accepted);
    });
  }

  showDictionaryPrompt(word: string, correction: string, onResponse: (accepted: boolean) => void): void {
    this.promptActive = true;
    this.clearPromptDismissTimer();
    this.show();

    const showUI = async () => {
      if (!this.window || this.window.isDestroyed()) return;
      await this.resizeWindow(true);
      this.window.setIgnoreMouseEvents(false);
      this.window.setFocusable(true);
      this.window.focus();
      this.window.webContents.send("capsule:show-dictionary", { word, correction });
      this.promptDismissTimer = setTimeout(() => {
        this.endPrompt();
        onResponse(false);
      }, 8000);
    };

    if (this.loadReady) {
      void showUI();
    } else {
      const check = setInterval(() => {
        if (this.loadReady) { clearInterval(check); void showUI(); }
      }, 50);
      setTimeout(() => clearInterval(check), 5000);
    }

    this.window?.webContents.ipc.once("capsule:dictionary-response", (_e, args: { accepted: boolean }) => {
      this.clearPromptDismissTimer();
      this.endPrompt();
      onResponse(args.accepted);
    });
  }

  hideExpanded(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:hide-expanded");
    void this.resizeWindow(false);
  }

  destroy(): void {
    this.clearPromptDismissTimer();
    this.promptActive = false;
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
      this.window = null;
    }
    this.loadReady = false;
    this.pendingMode = null;
    this.pendingBars = null;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async restoreFocusIfNeeded(
    originalFrontmost: { bundleId?: string; name?: string } | null | undefined
  ): Promise<void> {
    if (!originalFrontmost) return;
    await new Promise<void>((r) => setTimeout(r, 50));
    const currentFrontmost = nativeBridge.getFrontmostApplication?.();
    const currentBundleId  = currentFrontmost?.bundleId?.toLowerCase() ?? "";
    const originalBundleId = originalFrontmost.bundleId?.toLowerCase() ?? "";
    const ourBundleIds = ["com.claudevaani.app", "com.github.electron"];
    const weAreFrontmost = ourBundleIds.some((id) => currentBundleId.includes(id.toLowerCase()));
    if (weAreFrontmost && originalBundleId && !ourBundleIds.some((id) => originalBundleId.includes(id.toLowerCase()))) {
      try {
        const escapedId = originalBundleId.replace(/"/g, '\\"');
        await exec("osascript", ["-e", `tell application id "${escapedId}" to activate`]);
      } catch { /* best effort */ }
    }
  }

  private async resizeWindow(expanded: boolean): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return;
    const { screen } = await import("electron");
    const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
    const targetW = expanded ? PROMPT_W : PILL_W;
    const targetH = expanded ? PROMPT_H : PILL_H;
    const targetX = Math.round(x + width  / 2 - targetW / 2);
    const targetY = Math.round(y + height - targetH - CAPSULE_BOTTOM_MARGIN);
    this.window.setBounds({ x: targetX, y: targetY, width: targetW, height: targetH });
  }

  private endPrompt(): void {
    this.promptActive = false;
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:hide-expanded");
    this.window.setIgnoreMouseEvents(true, { forward: true });
    this.window.setFocusable(false);
    void this.resizeWindow(false);
    setTimeout(() => this.hide(), 400);
  }

  private clearPromptDismissTimer(): void {
    if (this.promptDismissTimer) {
      clearTimeout(this.promptDismissTimer);
      this.promptDismissTimer = null;
    }
  }

  private tryUpdateMode(mode: "idle" | "pressed" | "recording" | "transcribing" | "done" | "error"): void {
    if (!this.loadReady || !this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:set-mode", mode);
  }

  private async createWindow(): Promise<void> {
    const { screen } = await import("electron");
    const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
    const windowX = Math.round(x + width  / 2 - PILL_W / 2);
    const windowY = Math.round(y + height - PILL_H - CAPSULE_BOTTOM_MARGIN);

    this.window = new BrowserWindow({
      width:  PILL_W,
      height: PILL_H,
      x: windowX,
      y: windowY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      hasShadow: false,
      type: "panel",
      webPreferences: {
        preload: join(_dir, "overlay-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.setIgnoreMouseEvents(true, { forward: true });

    if (app.dock) {
      this.window.excludedFromShownWindowsMenu = true;
    }

    // Reset ready state if the renderer reloads (HMR) or crashes
    this.window.webContents.on("did-start-loading", () => { this.loadReady = false; });
    this.window.webContents.on("render-process-gone", () => { this.loadReady = false; });

    // React sends capsule:ready once mounted — use that as the authoritative signal
    this.window.webContents.ipc.on("capsule:ready", () => {
      this.loadReady = true;
      if (this.accentColor !== "#FF006E") {
        this.window?.webContents.send("capsule:set-accent", this.accentColor);
      }
      if (this.pendingMode) this.tryUpdateMode(this.pendingMode);
      if (this.pendingBars) this.updateBars(this.pendingBars);
    });

    // Fallback: if capsule:ready never fires (e.g. IPC timing issue), activate after page load
    this.window.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        if (!this.loadReady && this.window && !this.window.isDestroyed()) {
          this.loadReady = true;
          if (this.pendingMode) this.tryUpdateMode(this.pendingMode);
          if (this.pendingBars) this.updateBars(this.pendingBars);
        }
      }, 200);
    });

    if (typeof OVERLAY_WINDOW_VITE_DEV_SERVER_URL !== "undefined") {
      await this.window.loadURL(OVERLAY_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      await this.window.loadFile(join(_dir, `../renderer/${OVERLAY_WINDOW_VITE_NAME}/index.html`));
    }
  }
}
