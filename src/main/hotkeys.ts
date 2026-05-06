import { globalShortcut } from "electron";
import { HOTKEY_DOUBLE_PRESS_WINDOW_MS } from "@shared/defaults";
import type { Settings } from "@shared/types";
import { nativeBridge } from "./nativeBridge";

// Keys that the native event-tap handles but Electron globalShortcut cannot.
// These combos bypass Electron's shortcut system entirely.
const NATIVE_ONLY_TOKENS = new Set([
  "fn", "function",
  // Standalone modifiers with no key — Electron globalShortcut requires a non-modifier key
  "cmd", "command", "ctrl", "control", "option", "alt", "shift",
]);

/**
 * Returns true when a hotkey combo should be handled exclusively by the native
 * CGEventTap monitor and NOT registered with Electron's globalShortcut.
 */
export function isNativeOnlyAccelerator(combo: string): boolean {
  const lower = combo.toLowerCase().trim();
  // Single token — check against native-only set
  const parts = lower.split("+").map(p => p.trim());
  // If ALL parts are native-only tokens (e.g. "Fn", "Cmd") skip Electron
  if (parts.every(p => NATIVE_ONLY_TOKENS.has(p))) return true;
  // Single function keys are fine for Electron, but let native handle them too
  // (the native module already does F-keys); skipping to avoid conflicts
  if (parts.length === 1 && /^f\d{1,2}$/.test(lower)) return true;
  return false;
}

export function toElectronAccelerator(combo: string): string {
  return combo
    .replace(/cmd/gi, "Command")
    .replace(/command/gi, "Command")
    .replace(/option/gi, "Alt")
    .replace(/opt\b/gi, "Alt")
    .replace(/ctrl\b/gi, "Ctrl")
    .replace(/control\b/gi, "Ctrl")
    .replace(/shift/gi, "Shift")
    .replace(/alt\b/gi, "Alt")
    .replace(/super\b/gi, "Super")
    .replace(/space\b/gi, "Space")
    .replace(/return\b/gi, "Return")
    .replace(/enter\b/gi, "Return")
    .replace(/tab\b/gi, "Tab")
    .replace(/esc\b/gi, "Escape")
    .replace(/escape\b/gi, "Escape")
    .replace(/up\b/gi, "Up")
    .replace(/down\b/gi, "Down")
    .replace(/left\b/gi, "Left")
    .replace(/right\b/gi, "Right")
    .split("+")
    .map((part) => part.trim())
    .join("+");
}

export class HotkeyManager {
  private usingNativeMonitor = false;
  private usingNativePasteMonitor = false;
  private pasteLatestAccelerator: string | null = null;
  private captureActive = false;
  private lastPressTime = 0;
  private isToggleRecording = false;
  private escapeRegistered = false;
  private pendingReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressNextRelease = false;

  constructor(
    private readonly settingsProvider: () => Settings,
    private readonly onPress: () => void,
    private readonly onRelease: () => void,
    private readonly onCancel: () => void,
    private readonly onPasteLatest: () => void,
    private readonly onPrimaryHotkeyUnavailable: (message: string) => void
  ) {}

  register(): void {
    if (this.captureActive) {
      return;
    }

    this.unregister();
    const settings = this.settingsProvider();
    this.registerPasteLatest(settings.pasteLatestHotkey);

    const started = nativeBridge.startHotkeyMonitor?.(
      settings.primaryHotkey,
      (isPressed: boolean) => {
        if (isPressed) {
          this.handlePress();
          return;
        }
        this.handleRelease();
      }
    ) ?? false;

    if (started) {
      this.usingNativeMonitor = true;
      return;
    }

    console.warn("[vaani] primary dictation hotkey unavailable:", settings.primaryHotkey);
    this.onPrimaryHotkeyUnavailable("Dictation hotkey unavailable. Restart the app after the native module finishes building.");
  }

  reregister(): void {
    this.register();
  }

  setCaptureActive(active: boolean): void {
    if (this.captureActive === active) {
      return;
    }

    this.captureActive = active;
    if (active) {
      this.unregister();
      return;
    }

    this.register();
  }

  unregister(): void {
    this.clearPendingRelease();
    this.unregisterEscapeShortcut();
    this.isToggleRecording = false;
    this.suppressNextRelease = false;

    if (this.usingNativeMonitor) {
      try {
        nativeBridge.stopHotkeyMonitor?.();
      } catch (error) {
        console.warn("[vaani] failed to stop native hotkey monitor:", error);
      }
      this.usingNativeMonitor = false;
    }

    if (this.usingNativePasteMonitor) {
      try {
        nativeBridge.stopPasteLatestMonitor?.();
      } catch (error) {
        console.warn("[vaani] failed to stop native paste latest monitor:", error);
      }
      this.usingNativePasteMonitor = false;
    }

    if (this.pasteLatestAccelerator) {
      globalShortcut.unregister(this.pasteLatestAccelerator);
      this.pasteLatestAccelerator = null;
    }
  }

  private registerPasteLatest(combo: string): void {
    if (!combo) {
      return;
    }

    const startedNative = nativeBridge.startPasteLatestMonitor?.(combo, () => this.onPasteLatest()) ?? false;
    if (startedNative) {
      this.usingNativePasteMonitor = true;
      this.pasteLatestAccelerator = null;
      return;
    }

    // Skip Electron globalShortcut for native-only combos (Fn, standalone modifiers,
    // single F-keys) — these are handled exclusively by the native CGEventTap.
    if (isNativeOnlyAccelerator(combo)) {
      console.warn("[vaani] paste latest hotkey is native-only, skipping Electron globalShortcut:", combo);
      return;
    }

    const accelerator = toElectronAccelerator(combo);
    try {
      const ok = globalShortcut.register(accelerator, () => this.onPasteLatest());
      if (ok) {
        this.pasteLatestAccelerator = accelerator;
      } else {
        console.warn("[vaani] could not register paste latest hotkey:", accelerator);
      }
    } catch (error) {
      console.warn("[vaani] paste latest hotkey register error:", error);
    }
  }

  private handlePress(): void {
    const now = Date.now();
    const withinWindow = now - this.lastPressTime < HOTKEY_DOUBLE_PRESS_WINDOW_MS;

    if (this.isToggleRecording) {
      this.suppressNextRelease = true;
      this.exitToggleMode(false);
      this.lastPressTime = now;
      return;
    }

    if (this.pendingReleaseTimer && withinWindow) {
      this.clearPendingRelease();
      this.enterToggleMode();
      this.lastPressTime = now;
      return;
    }

    this.lastPressTime = now;
    this.onPress();
  }

  private handleRelease(): void {
    if (this.suppressNextRelease) {
      this.suppressNextRelease = false;
      return;
    }

    if (this.isToggleRecording) {
      return;
    }

    const heldFor = Date.now() - this.lastPressTime;
    if (heldFor < HOTKEY_DOUBLE_PRESS_WINDOW_MS) {
      this.clearPendingRelease();
      this.pendingReleaseTimer = setTimeout(() => {
        this.pendingReleaseTimer = null;
        this.onRelease();
      }, HOTKEY_DOUBLE_PRESS_WINDOW_MS);
      return;
    }

    this.onRelease();
  }

  private enterToggleMode(): void {
    this.isToggleRecording = true;
    this.clearPendingRelease();
    this.registerEscapeShortcut();
  }

  private exitToggleMode(cancel: boolean): void {
    this.isToggleRecording = false;
    this.unregisterEscapeShortcut();
    this.clearPendingRelease();
    if (cancel) {
      this.onCancel();
      return;
    }
    this.onRelease();
  }

  private registerEscapeShortcut(): void {
    if (this.escapeRegistered) {
      return;
    }

    try {
      this.escapeRegistered = globalShortcut.register("Escape", () => this.exitToggleMode(true));
      if (!this.escapeRegistered) {
        console.warn("[vaani] could not register Escape for toggle recording");
      }
    } catch (error) {
      console.warn("[vaani] escape shortcut register error:", error);
    }
  }

  private unregisterEscapeShortcut(): void {
    if (!this.escapeRegistered) {
      return;
    }

    globalShortcut.unregister("Escape");
    this.escapeRegistered = false;
  }

  private clearPendingRelease(): void {
    if (this.pendingReleaseTimer) {
      clearTimeout(this.pendingReleaseTimer);
      this.pendingReleaseTimer = null;
    }
  }
}
