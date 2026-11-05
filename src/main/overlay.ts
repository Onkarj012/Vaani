import { app, BrowserWindow, screen } from "electron";
import type { Rectangle } from "electron";
import type { DictationInsertionOutcome, DictationRejectionReason, DictionaryPromptValues, OverlayPrompt, OverlayPromptResult, OverlayStatus, SnippetPromptValues } from "@shared/types";
import { dictionaryEditError, isOverlayPromptReply, normalizeSnippetTrigger, snippetEditError } from "@shared/overlayPrompt";
import { nativeBridge } from "./nativeBridge";
import { PausableTimer } from "./pausableTimer";
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

// The renderer pads 19 px under the capsule for its shadow, so the capsule sits 25 px above the work area.
const CAPSULE_BOTTOM_MARGIN = 6;
// One click-through window for every capsule state, so state changes never resize it.
// Widest capsule is a three-line error (396 x 75 px); the rest is shadow clearance.
const CAPSULE_W = 440;
const CAPSULE_H = 104;
// Prompt window: the snippet edit card with an error line (342 x ~280 px) plus shadow clearance.
const PROMPT_W = 384;
const PROMPT_H = 320;
const PROMPT_DISMISS_MS = 8_000;
// Saved confirmation stays up this long after the reply.
const SAVED_HOLD_MS = 1_700;
// Success with a note and Cancelled stay up this long, even if dictation resets sooner.
const SUCCESS_NOTE_HOLD_MS = 2_000;
const CANCELLED_HOLD_MS = 900;
const OVERLAY_LOAD_TIMEOUT_MS = 2_000;
const OVERLAY_SHOW_WATCHDOG_MS = 900;

type OverlayMode = "idle" | "pressed" | "recording" | "transcribing" | "done" | "error" | "cancelled";

interface ActivePrompt {
  id: number;
  // Validates and saves an accepted reply. Returns an error to show, or null once saved.
  accept: (first: string, second: string) => string | null;
  dismiss: () => void;
  timer: PausableTimer | null;
}
export class OverlayController {
  private window: BrowserWindow | null = null;
  private loadReady = false;
  private creatingWindow: Promise<void> | null = null;
  private loadTimeout: ReturnType<typeof setTimeout> | null = null;
  private showWatchdog: ReturnType<typeof setTimeout> | null = null;
  private pendingMode: OverlayMode | null = null;
  private pendingLevel: number | null = null;
  private pendingDetectedLanguage: string | null = null;
  private pendingStatus: OverlayStatus | null = null;
  // True from prompt request until its window is released, including the Saved confirmation.
  private promptActive = false;
  private activePrompt: ActivePrompt | null = null;
  private savedHold: { timer: ReturnType<typeof setTimeout>; release: () => void; done: Promise<void> } | null = null;
  private promptGeneration = 0;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private resultHoldTimer: ReturnType<typeof setTimeout> | null = null;
  private hideAfterHold = false;
  private handsFree = false;
  private paused = false;
  private sessionId: string | null = null;
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
      if (this.pendingLevel !== null) {
        this.updateLevel(this.pendingLevel);
      }
      return;
    }
    this.loadReady = false;
    void this.ensureWindow().then(() => {
      log("overlay:show-created", { loadReady: this.loadReady });
      if (this.pendingMode) {
        this.tryUpdateMode(this.pendingMode);
      }
      if (this.pendingLevel !== null) {
        this.updateLevel(this.pendingLevel);
      }
      void this.restoreFocusIfNeeded(frontmostBefore);
    });
  }

  hide(): void {
    log("overlay:hide-requested", { promptActive: this.promptActive, hasWindow: !!this.window, loadReady: this.loadReady });
    if (this.promptActive) return;
    // A held result (success note, Cancelled) hides when its hold ends.
    if (this.resultHoldTimer) { this.hideAfterHold = true; return; }
    this.setStatusMessage(null);
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
    this.pendingLevel = null;
    this.pendingDetectedLanguage = null;
    this.resetHandsFreeState();
  }

  // Shows or hides the Pause and Send controls. The capsule widens while they show.
  setHandsFree(on: boolean): void {
    this.handsFree = on;
    if (!on) this.paused = false;
    this.sendHandsFreeState();
  }

  // Shows the paused state on the pill and its Pause button.
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.sendHandsFreeState();
  }

  setRecording(sessionId: string): void {
    this.finishActivePrompt();
    this.clearResultHold();
    this.setStatusMessage(null);
    this.sessionId = sessionId;
    this.pendingMode = "recording";
    this.pendingLevel = null;
    this.show();
    this.tryUpdateMode("recording");
  }

  setPressed(): void {
    this.finishActivePrompt();
    this.clearResultHold();
    this.setStatusMessage(null);
    this.pendingMode = "pressed";
    this.pendingDetectedLanguage = null;
    this.pendingLevel = null;
    this.show();
    this.tryUpdateMode("pressed");
  }

  // Shows "Cancelled" briefly. Call before dictation resets; the reset's hide waits for the hold.
  setCancelled(): void {
    this.finishActivePrompt();
    this.clearResultHold();
    this.setStatusMessage(null);
    this.handsFree = false;
    this.paused = false;
    this.sendHandsFreeState();
    if (this.window && !this.window.isDestroyed()) this.window.setIgnoreMouseEvents(true, { forward: true });
    this.pendingMode = "cancelled";
    this.pendingLevel = null;
    this.show();
    this.tryUpdateMode("cancelled");
    this.holdResult(CANCELLED_HOLD_MS);
  }

  // A new dictation is taking over the overlay — neutralize any lingering prompt
  // so its pending dismiss timer cannot later hide the live recording pill.
  private finishActivePrompt(): void {
    if (!this.promptActive) return;
    this.promptGeneration += 1;
    const prompt = this.activePrompt;
    this.activePrompt = null;
    prompt?.timer?.cancel();
    this.clearSavedHold();
    this.promptActive = false;
    this.resetPromptWindowState();
    prompt?.dismiss();
  }

  setProcessing(): void {
    this.pendingMode = "transcribing";
    this.show();
  }

  // Sets the capsule's status text. The reason or insertion outcome picks the error title.
  setStatusMessage(message: string | null, cause: { reason?: DictationRejectionReason | null; insertion?: DictationInsertionOutcome | null } = {}): void {
    // A held result keeps its note until the hold ends; hide() clears it then.
    if (message === null && this.resultHoldTimer) return;
    this.pendingStatus = message === null ? null : { message, reason: cause.reason ?? null, insertion: cause.insertion ?? null };
    if (this.loadReady && this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("capsule:set-status", this.pendingStatus);
    }
  }

  // Success disc. A note set just before keeps the capsule up long enough to read.
  setSuccess(detectedLanguage?: string | null): void {
    this.pendingMode = "done";
    this.pendingDetectedLanguage = detectedLanguage ?? null;
    this.show();
    this.flushPendingDetectedLanguage();
    if (this.pendingStatus) this.holdResult(SUCCESS_NOTE_HOLD_MS);
  }

  setError(): void {
    this.pendingMode = "error";
    this.show();
  }

  // Sends the 0-1 mic level (fixed dB scale) that drives the ribbon waveform.
  updateLevel(level: number): void {
    this.pendingLevel = level;
    if (!this.loadReady || !this.window || this.window.isDestroyed()) return;
    if (this.pendingMode === "pressed") {
      this.pendingMode = "recording";
      this.window.webContents.send("capsule:set-mode", "recording");
    }
    this.window.webContents.send("capsule:update-level", level);
  }

  // ── Prompts ──────────────────────────────────────────────────────────────

  // Offers to save a snippet. Resolves with the (possibly edited) values, or null when skipped or dismissed.
  showSnippetPrompt(
    trigger: string,
    text: string,
    onResponse: (values: SnippetPromptValues | null) => void,
    takenTriggers: () => readonly string[] = () => [],
  ): void {
    const dismiss = once(() => onResponse(null));
    const accept = (first: string, second: string): string | null => {
      const values = { trigger: normalizeSnippetTrigger(first), text: second.trim() };
      const error = snippetEditError(values, takenTriggers());
      if (error) return error;
      onResponse(values);
      return null;
    };
    void this.showPromptAsync({ kind: "snippet", trigger, text }, accept, dismiss).catch(() => {
      this.activePrompt = null;
      this.endPrompt();
      dismiss();
    });
  }

  // Offers to add a dictionary rule. Resolves with the (possibly edited) values, or null.
  // `check` adds checks only main can make, such as an existing manual rule.
  showDictionaryPrompt(
    spoken: string,
    written: string,
    onResponse: (values: DictionaryPromptValues | null) => void,
    check: (values: DictionaryPromptValues) => string | null = () => null,
  ): void {
    const dismiss = once(() => onResponse(null));
    const accept = (first: string, second: string): string | null => {
      const values = { spoken: first.trim(), written: second.trim() };
      const error = dictionaryEditError(values) ?? check(values);
      if (error) return error;
      onResponse(values);
      return null;
    };
    void this.showPromptAsync({ kind: "dictionary", spoken, written }, accept, dismiss).catch(() => {
      this.activePrompt = null;
      this.endPrompt();
      dismiss();
    });
  }

  private async showPromptAsync(
    base: Omit<Extract<OverlayPrompt, { kind: "snippet" }>, "id" | "durationMs"> | Omit<Extract<OverlayPrompt, { kind: "dictionary" }>, "id" | "durationMs">,
    accept: ActivePrompt["accept"],
    dismiss: () => void,
  ): Promise<void> {
    log("overlay:prompt-requested", { kind: base.kind, hasWindow: !!this.window, loadReady: this.loadReady });
    const id = this.promptGeneration + 1;
    this.promptGeneration = id;
    // Only one prompt at a time; an older one counts as dismissed.
    const previous = this.activePrompt;
    this.activePrompt = null;
    previous?.timer?.cancel();
    previous?.dismiss();
    this.clearResultHold();
    this.promptActive = true;
    // The next prompt waits for the previous Saved confirmation to finish.
    if (this.savedHold) await this.savedHold.done;
    if (id !== this.promptGeneration) { dismiss(); return; }
    // The Saved hold's endPrompt() cleared this while we waited.
    this.promptActive = true;
    const frontmostBefore = nativeBridge.getFrontmostApplication?.();
    await this.ensureWindow();
    await this.waitForLoadReady(5_000);
    if (id !== this.promptGeneration) {
      dismiss();
      return;
    }
    if (!this.window || this.window.isDestroyed()) throw new Error("Overlay window unavailable.");

    const prompt: ActivePrompt = { id, accept, dismiss, timer: null };
    this.activePrompt = prompt;
    const promptWindow = this.window;
    await this.showPromptWindow(frontmostBefore);
    if (this.activePrompt !== prompt || promptWindow.isDestroyed()) return;
    const payload: OverlayPrompt = { ...base, id, durationMs: PROMPT_DISMISS_MS };
    promptWindow.webContents.send("capsule:show-prompt", payload);
    prompt.timer = new PausableTimer(() => this.expirePrompt(prompt), PROMPT_DISMISS_MS);
  }

  // Handles Save, Skip, and edited values from the prompt card.
  private handlePromptReply(reply: unknown): OverlayPromptResult {
    const prompt = this.activePrompt;
    if (!isOverlayPromptReply(reply) || !prompt || reply.id !== prompt.id) {
      return { ok: false, error: "This suggestion has closed." };
    }
    if (!reply.accepted) {
      this.activePrompt = null;
      prompt.timer?.cancel();
      this.endPrompt();
      prompt.dismiss();
      return { ok: true };
    }
    const error = prompt.accept(reply.first, reply.second);
    if (error) return { ok: false, error };
    this.activePrompt = null;
    prompt.timer?.cancel();
    this.holdSavedConfirmation();
    return { ok: true };
  }

  // Pauses the countdown while the pointer or keyboard focus is on the card, or while editing.
  private setPromptHeld(held: boolean): void {
    const timer = this.activePrompt?.timer;
    if (!timer) return;
    if (held) timer.pause();
    else timer.resume();
  }

  private expirePrompt(prompt: ActivePrompt): void {
    if (this.activePrompt !== prompt) return;
    this.activePrompt = null;
    this.endPrompt();
    prompt.dismiss();
  }

  // Keeps the window up so the renderer can show "Rule added" or "Snippet saved".
  private holdSavedConfirmation(): void {
    this.clearSavedHold();
    let release = (): void => {};
    const done = new Promise<void>((resolve) => { release = resolve; });
    const timer = setTimeout(() => {
      this.savedHold = null;
      this.endPrompt();
      release();
    }, SAVED_HOLD_MS);
    this.savedHold = { timer, release, done };
  }

  private clearSavedHold(): void {
    if (!this.savedHold) return;
    clearTimeout(this.savedHold.timer);
    const { release } = this.savedHold;
    this.savedHold = null;
    release();
  }

  // Keeps a result on screen for at least `ms`; a hide() in the meantime runs when it ends.
  private holdResult(ms: number): void {
    this.clearResultHold();
    this.resultHoldTimer = setTimeout(() => {
      this.resultHoldTimer = null;
      if (!this.hideAfterHold) return;
      this.hideAfterHold = false;
      this.hide();
    }, ms);
  }

  private clearResultHold(): void {
    if (this.resultHoldTimer) clearTimeout(this.resultHoldTimer);
    this.resultHoldTimer = null;
    this.hideAfterHold = false;
  }

  hideExpanded(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:hide-expanded");
    this.applyBounds();
  }

  destroy(): void {
    log("overlay:destroy-requested", { hasWindow: !!this.window, loadReady: this.loadReady, pendingMode: this.pendingMode });
    this.clearHideTimer();
    this.clearResultHold();
    this.activePrompt?.timer?.cancel();
    this.activePrompt = null;
    this.clearSavedHold();
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
    this.pendingLevel = null;
    this.handsFree = false;
    this.paused = false;
    this.sessionId = null;
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

  // Centers the window at the bottom of the cursor's display: prompt size while a prompt is up, capsule size otherwise.
  private applyBounds(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const { x, y, width, height } = this.getTargetWorkArea();
    const targetW = this.promptActive ? PROMPT_W : CAPSULE_W;
    const targetH = this.promptActive ? PROMPT_H : CAPSULE_H;
    this.window.setBounds({
      x: Math.round(x + width / 2 - targetW / 2),
      y: Math.round(y + height - targetH - CAPSULE_BOTTOM_MARGIN),
      width: targetW,
      height: targetH,
    });
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
    this.resetPromptWindowState();
    if (!this.window || this.window.isDestroyed()) return;
    this.clearHideTimer();
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this.promptActive) this.hide();
    }, 400);
  }

  // Clears hands-free, paused, and pointer state once the pill goes idle.
  private resetHandsFreeState(): void {
    this.handsFree = false;
    this.paused = false;
    this.sessionId = null;
    this.applyBounds();
    this.sendHandsFreeState();
    if (this.window && !this.window.isDestroyed() && !this.promptActive) {
      this.window.setIgnoreMouseEvents(true, { forward: true });
    }
  }

  // Lets the pointer reach the Pause and Send controls. Prompts always take clicks.
  private setInteractive(interactive: boolean): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.setIgnoreMouseEvents(this.promptActive ? false : !interactive, { forward: true });
  }

  // Sends the hands-free, paused, and session values the renderer needs for its controls.
  private sendHandsFreeState(): void {
    if (!this.loadReady || !this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:set-hands-free", this.handsFree);
    this.window.webContents.send("capsule:set-paused", this.paused);
    this.window.webContents.send("capsule:set-session", this.sessionId);
  }

  private resetPromptWindowState(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:hide-expanded");
    this.window.setIgnoreMouseEvents(true, { forward: true });
    this.window.setFocusable(false);
    this.applyBounds();
  }

  private clearHideTimer(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
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
      if (this.pendingLevel !== null) {
        this.updateLevel(this.pendingLevel);
      }
    }, OVERLAY_SHOW_WATCHDOG_MS);
  }

  private tryUpdateMode(mode: OverlayMode): void {
    if (!this.loadReady || !this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:set-mode", mode);
    // A mode update can reach the renderer after hands-free was sent, so resend it last.
    this.sendHandsFreeState();
  }

  private flushPendingDetectedLanguage(): void {
    if (!this.pendingDetectedLanguage || !this.loadReady || !this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:set-lang", this.pendingDetectedLanguage);
    this.pendingDetectedLanguage = null;
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

    this.applyBounds();
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
    if (this.pendingLevel !== null) {
      this.updateLevel(this.pendingLevel);
    }
    this.flushPendingDetectedLanguage();

    this.armShowWatchdog(this.window);
    await this.restoreFocusIfNeeded(originalFrontmost);
  }

  private async createWindow(): Promise<void> {
    log("overlay:create");
    // Use cursor display (same as presentWindow) to avoid position mismatch.
    // createWindow sets initial bounds that match where the capsule will appear.
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const windowX = Math.round(area.x + area.width / 2 - CAPSULE_W / 2);
    const windowY = Math.round(area.y + area.height - CAPSULE_H - CAPSULE_BOTTOM_MARGIN);

    const win = new BrowserWindow({
      width:  CAPSULE_W,
      height: CAPSULE_H,
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
      if (this.handsFree || this.paused) this.sendHandsFreeState();
      if (this.accentColor !== "#FF006E") {
        this.window?.webContents.send("capsule:set-accent", this.accentColor);
      }
      // Retry mode update multiple times to ensure it arrives after HMR listener setup
      if (this.pendingMode) {
        this.tryUpdateMode(this.pendingMode);
        setTimeout(() => this.pendingMode && this.tryUpdateMode(this.pendingMode), 50);
        setTimeout(() => this.pendingMode && this.tryUpdateMode(this.pendingMode), 150);
      }
      if (this.pendingLevel !== null) this.updateLevel(this.pendingLevel);
      this.flushPendingDetectedLanguage();
      if (this.pendingStatus) this.window?.webContents.send("capsule:set-status", this.pendingStatus);
    });

    // Only the overlay renderer can report pointer position over its controls.
    win.webContents.ipc.on("capsule:set-interactive", (_event, interactive: unknown) => {
      if (typeof interactive === "boolean") this.setInteractive(interactive);
    });

    // Prompt replies come back on the window that showed the prompt.
    win.webContents.ipc.handle("capsule:prompt-reply", (_event, reply: unknown) => this.handlePromptReply(reply));
    win.webContents.ipc.on("capsule:prompt-hold", (_event, held: unknown) => {
      if (typeof held === "boolean") this.setPromptHeld(held);
    });

    // Fallback: if capsule:ready never fires (e.g. IPC timing issue), activate after page load
    win.webContents.on("did-finish-load", () => {
      log("overlay:loaded", { url: win.webContents.getURL() });
      setTimeout(() => {
        if (!this.loadReady && this.window && !this.window.isDestroyed()) {
          log("overlay:ready-fallback");
          this.clearLoadTimeout();
          this.loadReady = true;
          if (this.handsFree || this.paused) this.sendHandsFreeState();
          if (this.pendingMode) this.tryUpdateMode(this.pendingMode);
          if (this.pendingLevel !== null) this.updateLevel(this.pendingLevel);
          this.flushPendingDetectedLanguage();
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

// Wraps a callback so it runs at most once.
function once(fn: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    fn();
  };
}

function log(label: string, data?: unknown): void {
  try {
    const line = `[${new Date().toISOString()}] ${label}${data !== undefined ? ` ${JSON.stringify(data)}` : ""}\n`;
    appendFileSync(logPath, line, "utf8");
  } catch {
    // best-effort logging
  }
}
