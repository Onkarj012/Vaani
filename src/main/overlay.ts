import { app, BrowserWindow, screen } from "electron";
import type { Rectangle } from "electron";
import { nativeBridge } from "./nativeBridge";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

declare const OVERLAY_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const OVERLAY_WINDOW_VITE_NAME: string;
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const _dir = dirname(fileURLToPath(import.meta.url));
const logPath = join(tmpdir(), "vaani-startup.log");

const CAPSULE_BOTTOM_MARGIN = 16;
// Non-prompt: fits the recording waveform pill (9 bars × 5px + padding)
const PILL_W = 120;
const PILL_H = 52;
// Prompt card: matches CapsuleOverlay.tsx prompt width (340px) + shadow clearance
const PROMPT_W = 360;
const PROMPT_H = 210;
const OVERLAY_LOAD_TIMEOUT_MS = 2_000;
const OVERLAY_SHOW_WATCHDOG_MS = 900;
export class OverlayController {
  private window: BrowserWindow | null = null;
  private loadReady = false;
  private creatingWindow: Promise<void> | null = null;
  private loadTimeout: ReturnType<typeof setTimeout> | null = null;
  private showWatchdog: ReturnType<typeof setTimeout> | null = null;
  private pendingMode: "idle" | "pressed" | "recording" | "transcribing" | "done" | "error" | null = null;
  private pendingBars: number[] | null = null;
  private promptActive = false;
  private promptDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPromptRemover: (() => void) | null = null;
  private pendingPromptResponder: ((accepted: boolean) => void) | null = null;
  private promptGeneration = 0;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private accentColor = "#FF006E";
  // ── Public setters ────────────────────────────────────────────────────────

  getWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

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
    void this.ensureWindow();
  }

  show(): void {
    this.clearHideTimer();
    const frontmostBefore = nativeBridge.getFrontmostApplication?.();
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.webContents.isCrashed()) {
        this.recoverWindow("show-crashed");
        return;
      }
      log("overlay:show-existing", { loadReady: this.loadReady, visible: this.window.isVisible() });
      // If the renderer isn't ready yet, go through presentWindow so the
      // watchdog is armed and mode retries are scheduled — otherwise the
      // fast-path showInactive() call leaves the window blank.
      if (!this.loadReady) {
        void this.presentWindow(frontmostBefore);
        return;
      }
      this.window.showInactive();
      if (this.pendingMode) {
        this.tryUpdateMode(this.pendingMode);
        setTimeout(() => this.pendingMode && this.tryUpdateMode(this.pendingMode), 80);
      }
      if (this.pendingBars) {
        this.updateBars(this.pendingBars);
      }
      return;
    }
    this.loadReady = false;
    void this.ensureWindow().then(() => {
      log("overlay:show-created", { loadReady: this.loadReady });
      if (this.pendingMode) {
        this.tryUpdateMode(this.pendingMode);
      }
      if (this.pendingBars) {
        this.updateBars(this.pendingBars);
      }
      void this.restoreFocusIfNeeded(frontmostBefore);
    });
  }

  hide(): void {
    log("overlay:hide-requested", { promptActive: this.promptActive, hasWindow: !!this.window, loadReady: this.loadReady });
    if (this.promptActive) return;
    if (this.window && !this.window.isDestroyed()) {
      this.tryUpdateMode("idle");
      // Delay window.hide() to let the React exit animation complete
      // (spring transition ~200ms). Immediate hide causes visual jump.
      this.clearHideTimer();
      const w = this.window;
      this.hideTimer = setTimeout(() => {
        if (w && !w.isDestroyed() && this.window === w) {
          log("overlay:hide-commit");
          w.hide();
        }
        this.hideTimer = null;
      }, 250);
    }
    this.pendingMode = null;
    this.pendingBars = null;
  }

  setRecording(): void {
    this.finishActivePrompt();
    this.pendingMode = "recording";
    this.pendingBars = null;
    this.show();
    this.tryUpdateMode("recording");
  }

  setPressed(): void {
    this.finishActivePrompt();
    this.pendingMode = "pressed";
    this.pendingBars = null;
    this.show();
    this.tryUpdateMode("pressed");
  }

  // A new dictation is taking over the overlay — neutralize any lingering prompt
  // so its pending dismiss timer cannot later hide the live recording pill.
  private finishActivePrompt(): void {
    if (!this.promptActive) return;
    this.promptGeneration += 1;
    this.clearPromptDismissTimer();
    this.pendingPromptRemover?.();
    this.pendingPromptRemover = null;
    const responder = this.pendingPromptResponder;
    this.pendingPromptResponder = null;
    this.promptActive = false;
    this.resetPromptWindowState();
    responder?.(false);
  }

  setProcessing(): void {
    this.pendingMode = "transcribing";
    this.show();
  }

  setSuccess(_detectedLanguage?: string | null): void {
    this.pendingMode = "done";
    this.show();
  }

  setError(): void {
    this.pendingMode = "error";
    this.show();
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
    void this.showSnippetPromptAsync(trigger, onResponse).catch(() => {
      this.endPrompt();
      onResponse(false);
    });
  }

  showDictionaryPrompt(word: string, correction: string, onResponse: (accepted: boolean) => void): void {
    void this.showDictionaryPromptAsync(word, correction, onResponse).catch(() => {
      this.endPrompt();
      onResponse(false);
    });
  }

  private async showSnippetPromptAsync(trigger: string, onResponse: (accepted: boolean) => void): Promise<void> {
    log("overlay:prompt-snippet-requested", { hasWindow: !!this.window, loadReady: this.loadReady });
    const promptGeneration = this.promptGeneration + 1;
    this.promptGeneration = promptGeneration;
    this.promptActive = true;
    this.clearPromptDismissTimer();
    const frontmostBefore = nativeBridge.getFrontmostApplication?.();
    await this.ensureWindow();
    await this.waitForLoadReady(5_000);
    if (promptGeneration !== this.promptGeneration) {
      onResponse(false);
      return;
    }
    if (!this.window || this.window.isDestroyed()) throw new Error("Overlay window unavailable.");

    const responseHandler = (_e: Electron.IpcMainEvent, args: { accepted: boolean }) => {
      this.clearPromptDismissTimer();
      this.endPrompt();
      onResponse(args.accepted);
    };
    const promptWindow = this.window;
    this.pendingPromptRemover?.();
    this.pendingPromptResponder = onResponse;
    promptWindow.webContents.ipc.once("capsule:snippet-response", responseHandler);
    // Store remover so endPrompt/recover can clean it up
    this.pendingPromptRemover = () => promptWindow.webContents.ipc.removeListener("capsule:snippet-response", responseHandler);

    await this.showPromptWindow(frontmostBefore);
    promptWindow.webContents.send("capsule:show-snippet", { trigger });
    this.promptDismissTimer = setTimeout(() => {
      this.pendingPromptResponder = null;
      this.endPrompt();
      onResponse(false);
    }, 8000);
  }

  private async showDictionaryPromptAsync(word: string, correction: string, onResponse: (accepted: boolean) => void): Promise<void> {
    log("overlay:prompt-dictionary-requested", { hasWindow: !!this.window, loadReady: this.loadReady });
    const promptGeneration = this.promptGeneration + 1;
    this.promptGeneration = promptGeneration;
    this.promptActive = true;
    this.clearPromptDismissTimer();
    const frontmostBefore = nativeBridge.getFrontmostApplication?.();
    await this.ensureWindow();
    await this.waitForLoadReady(5_000);
    if (promptGeneration !== this.promptGeneration) {
      onResponse(false);
      return;
    }
    if (!this.window || this.window.isDestroyed()) throw new Error("Overlay window unavailable.");

    const dictResponseHandler = (_e: Electron.IpcMainEvent, args: { accepted: boolean }) => {
      this.clearPromptDismissTimer();
      this.endPrompt();
      onResponse(args.accepted);
    };
    const promptWindow = this.window;
    this.pendingPromptRemover?.();
    this.pendingPromptResponder = onResponse;
    promptWindow.webContents.ipc.once("capsule:dictionary-response", dictResponseHandler);
    this.pendingPromptRemover = () => promptWindow.webContents.ipc.removeListener("capsule:dictionary-response", dictResponseHandler);

    await this.showPromptWindow(frontmostBefore);
    promptWindow.webContents.send("capsule:show-dictionary", { word, correction });
    this.promptDismissTimer = setTimeout(() => {
      this.pendingPromptResponder = null;
      this.endPrompt();
      onResponse(false);
    }, 8000);
  }

  hideExpanded(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:hide-expanded");
    void this.resizeWindow(false);
  }

  destroy(): void {
    log("overlay:destroy-requested", { hasWindow: !!this.window, loadReady: this.loadReady, pendingMode: this.pendingMode });
    this.clearHideTimer();
    this.clearPromptDismissTimer();
    this.pendingPromptRemover?.();
    this.pendingPromptRemover = null;
    this.promptActive = false;
    this.clearLoadTimeout();
    this.clearShowWatchdog();
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
      this.window = null;
    }
    this.creatingWindow = null;
    this.loadReady = false;
    this.pendingMode = null;
    this.pendingBars = null;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async restoreFocusIfNeeded(
    _originalFrontmost: { bundleId?: string; name?: string } | null | undefined
  ): Promise<void> {
    // Disabled: The overlay uses showInactive() and focusable: false, so it
    // shouldn't steal focus. Actively restoring focus via osascript can cause
    // the main dashboard window to disappear on macOS when focus moves away.
    // The target app retains focus throughout the recording flow.
  }

  private async resizeWindow(expanded: boolean): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return;
    const { x, y, width, height } = this.getTargetWorkArea();
    const targetW = expanded ? PROMPT_W : PILL_W;
    const targetH = expanded ? PROMPT_H : PILL_H;
    const targetX = Math.round(x + width  / 2 - targetW / 2);
    const targetY = Math.round(y + height - targetH - CAPSULE_BOTTOM_MARGIN);
    this.window.setBounds({ x: targetX, y: targetY, width: targetW, height: targetH });
  }

  private async showPromptWindow(
    frontmostBefore: { bundleId?: string; name?: string } | null | undefined,
    focusWindow = true
  ): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return;
    log("overlay:prompt-window-show", { loadReady: this.loadReady, focusWindow });
    this.clearHideTimer();
    this.window.setFocusable(focusWindow);
    await this.presentWindow(frontmostBefore);
    this.window.setIgnoreMouseEvents(false);
    this.window.setFocusable(focusWindow);
    if (focusWindow) this.window.focus();
  }

  private waitForLoadReady(timeoutMs: number): Promise<void> {
    if (this.loadReady) return Promise.resolve();
    log("overlay:wait-ready", { timeoutMs });
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = setInterval(() => {
        if (this.loadReady) {
          clearInterval(check);
          log("overlay:wait-ready-complete", { elapsedMs: Date.now() - startedAt });
          resolve();
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(check);
          log("overlay:wait-ready-timeout", { elapsedMs: Date.now() - startedAt });
          reject(new Error("Overlay renderer did not become ready."));
        }
      }, 50);
    });
  }

  private endPrompt(): void {
    log("overlay:prompt-end", { hasWindow: !!this.window });
    this.promptActive = false;
    this.pendingPromptRemover?.();
    this.pendingPromptRemover = null;
    this.pendingPromptResponder = null;
    this.resetPromptWindowState();
    if (!this.window || this.window.isDestroyed()) return;
    this.clearHideTimer();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this.promptActive) this.hide();
    }, 400);
  }

  private resetPromptWindowState(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:hide-expanded");
    this.window.setIgnoreMouseEvents(true, { forward: true });
    this.window.setFocusable(false);
    void this.resizeWindow(false);
  }

  private clearHideTimer(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private clearPromptDismissTimer(): void {
    if (this.promptDismissTimer) {
      clearTimeout(this.promptDismissTimer);
      this.promptDismissTimer = null;
    }
  }

  private clearLoadTimeout(): void {
    if (this.loadTimeout) {
      clearTimeout(this.loadTimeout);
      this.loadTimeout = null;
    }
  }

  private clearShowWatchdog(): void {
    if (this.showWatchdog) {
      clearTimeout(this.showWatchdog);
      this.showWatchdog = null;
    }
  }

  private armLoadTimeout(win: BrowserWindow): void {
    this.clearLoadTimeout();
    this.loadTimeout = setTimeout(() => {
      if (this.window !== win || win.isDestroyed() || this.loadReady) {
        return;
      }

      log("overlay:load-timeout", { loading: win.webContents.isLoading() });
      this.recoverWindow("load-timeout");
    }, OVERLAY_LOAD_TIMEOUT_MS);
  }

  private armShowWatchdog(win: BrowserWindow): void {
    this.clearShowWatchdog();
    this.showWatchdog = setTimeout(() => {
      if (this.window !== win || win.isDestroyed()) {
        return;
      }

      const unhealthy = win.webContents.isCrashed() || !this.loadReady || !win.isVisible();
      log("overlay:show-watchdog", {
        unhealthy,
        loadReady: this.loadReady,
        visible: win.isVisible(),
        crashed: win.webContents.isCrashed(),
        pendingMode: this.pendingMode
      });

      if (unhealthy && this.pendingMode) {
        this.recoverWindow("show-watchdog");
        return;
      }

      if (this.pendingMode) {
        this.tryUpdateMode(this.pendingMode);
      }
      if (this.pendingBars) {
        this.updateBars(this.pendingBars);
      }
    }, OVERLAY_SHOW_WATCHDOG_MS);
  }

  private tryUpdateMode(mode: "idle" | "pressed" | "recording" | "transcribing" | "done" | "error"): void {
    if (!this.loadReady || !this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:set-mode", mode);
  }

  private ensureWindow(): Promise<void> {
    if (this.window && !this.window.isDestroyed()) {
      return Promise.resolve();
    }

    if (!this.creatingWindow) {
      this.loadReady = false;
      this.creatingWindow = this.createWindow().finally(() => {
        this.creatingWindow = null;
      });
    }

    return this.creatingWindow;
  }

  private recoverWindow(reason: string): void {
    log("overlay:recover", { reason, hasWindow: !!this.window });
    const oldWindow = this.window;
    this.window = null;
    this.loadReady = false;
    this.creatingWindow = null;
    this.clearLoadTimeout();
    this.clearShowWatchdog();

    if (oldWindow && !oldWindow.isDestroyed()) {
      oldWindow.destroy();
    }

    void this.ensureWindow().then(() => {
      if (this.pendingMode && this.window && !this.window.isDestroyed()) {
        void this.presentWindow(nativeBridge.getFrontmostApplication?.());
      }
    });
  }

  private getTargetWorkArea(): Rectangle {
    const cursor = screen.getCursorScreenPoint();
    return screen.getDisplayNearestPoint(cursor).workArea;
  }

  private async presentWindow(
    originalFrontmost: { bundleId?: string; name?: string } | null | undefined
  ): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    const { x, y, width, height } = this.getTargetWorkArea();
    const targetW = this.promptActive ? PROMPT_W : PILL_W;
    const targetH = this.promptActive ? PROMPT_H : PILL_H;
    this.window.setBounds({
      x: Math.round(x + width / 2 - targetW / 2),
      y: Math.round(y + height - targetH - CAPSULE_BOTTOM_MARGIN),
      width: targetW,
      height: targetH
    });
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.setIgnoreMouseEvents(!this.promptActive, { forward: true });

    try {
      this.window.showInactive();
    } catch { /* best effort */ }

    if (this.pendingMode) {
      this.tryUpdateMode(this.pendingMode);
      setTimeout(() => this.pendingMode && this.tryUpdateMode(this.pendingMode), 100);
      setTimeout(() => this.pendingMode && this.tryUpdateMode(this.pendingMode), 300);
    }
    if (this.pendingBars) {
      this.updateBars(this.pendingBars);
    }

    this.armShowWatchdog(this.window);
    await this.restoreFocusIfNeeded(originalFrontmost);
  }

  private async createWindow(): Promise<void> {
    log("overlay:create");
    // Use cursor display (same as presentWindow) to avoid position mismatch.
    // createWindow sets initial bounds that match where the capsule will appear.
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const windowX = Math.round(area.x + area.width / 2 - PILL_W / 2);
    const windowY = Math.round(area.y + area.height - PILL_H - CAPSULE_BOTTOM_MARGIN);

    const win = new BrowserWindow({
      width:  PILL_W,
      height: PILL_H,
      x: windowX,
      y: windowY,
      show: false,
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
        backgroundThrottling: false
      },
    });
    this.window = win;

    win.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setIgnoreMouseEvents(true, { forward: true });

    if (app.dock) {
      win.excludedFromShownWindowsMenu = true;
    }

    // Reset ready state if the renderer reloads (HMR) or crashes
    win.webContents.on("did-start-loading", () => {
      log("overlay:loading");
      this.loadReady = false;
      this.armLoadTimeout(win);
    });
    win.webContents.on("did-fail-load", (_event, code, desc) => {
      log("overlay:fail", { code, desc });
      this.loadReady = false;
      this.recoverWindow("load-failed");
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      log("overlay:gone", details);
      this.loadReady = false;
      this.recoverWindow("renderer-gone");
    });
    win.on("unresponsive", () => {
      log("overlay:unresponsive");
      this.loadReady = false;
      win.webContents.forcefullyCrashRenderer();
      this.recoverWindow("unresponsive");
    });
    win.on("closed", () => {
      if (this.window === win) {
        this.window = null;
        this.loadReady = false;
        this.clearLoadTimeout();
        this.clearShowWatchdog();
      }
    });

    // React sends capsule:ready once mounted — use that as the authoritative signal
    win.webContents.ipc.on("capsule:ready", () => {
      log("overlay:ready");
      this.clearLoadTimeout();
      this.loadReady = true;
      if (this.accentColor !== "#FF006E") {
        this.window?.webContents.send("capsule:set-accent", this.accentColor);
      }
      // Retry mode update multiple times to ensure it arrives after HMR listener setup
      if (this.pendingMode) {
        this.tryUpdateMode(this.pendingMode);
        setTimeout(() => this.pendingMode && this.tryUpdateMode(this.pendingMode), 50);
        setTimeout(() => this.pendingMode && this.tryUpdateMode(this.pendingMode), 150);
      }
      if (this.pendingBars) this.updateBars(this.pendingBars);
    });

    // Fallback: if capsule:ready never fires (e.g. IPC timing issue), activate after page load
    win.webContents.on("did-finish-load", () => {
      log("overlay:loaded", { url: win.webContents.getURL() });
      setTimeout(() => {
        if (!this.loadReady && this.window && !this.window.isDestroyed()) {
          log("overlay:ready-fallback");
          this.clearLoadTimeout();
          this.loadReady = true;
          if (this.pendingMode) this.tryUpdateMode(this.pendingMode);
          if (this.pendingBars) this.updateBars(this.pendingBars);
        }
      }, 200);
    });

    // Log all console messages from overlay for debugging
    win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      log("overlay:console", { level, message: message.slice(0, 300), line, sourceId });
    });

    if (typeof OVERLAY_WINDOW_VITE_DEV_SERVER_URL !== "undefined") {
      const overlayUrl = OVERLAY_WINDOW_VITE_DEV_SERVER_URL;
      log("overlay:loading-url", { url: overlayUrl });
      await win.loadURL(overlayUrl);
    } else {
      const filePath = join(_dir, `../renderer/${OVERLAY_WINDOW_VITE_NAME}/index.html`);
      log("overlay:loading-file", { path: filePath });
      await win.loadFile(filePath);
    }

    // Do not show purely because the renderer loaded. Visibility is owned by
    // presentWindow(), otherwise a late load can resurrect a window after a
    // session reset/hide raced with creation.
    if (this.pendingMode || this.promptActive) {
      await this.presentWindow(nativeBridge.getFrontmostApplication?.());
    }
  }
}

function log(label: string, data?: unknown): void {
  try {
    const line = `[${new Date().toISOString()}] ${label}${data !== undefined ? ` ${JSON.stringify(data)}` : ""}\n`;
    appendFileSync(logPath, line, "utf8");
  } catch {
    // best-effort logging
  }
}
