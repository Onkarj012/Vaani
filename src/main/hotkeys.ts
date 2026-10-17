import { globalShortcut } from "electron";
import { HOTKEY_DOUBLE_PRESS_WINDOW_MS } from "@shared/defaults";
import { parseHotkey } from "@shared/hotkeys";
import type { DictationMode, Settings } from "@shared/types";
import { nativeBridge } from "./nativeBridge";

const NATIVE_ONLY_TOKENS = new Set([
  "fn", "function",
  "cmd", "command", "ctrl", "control", "option", "alt", "shift",
]);

export function isNativeOnlyAccelerator(combo: string): boolean {
  const lower = combo.toLowerCase().trim();
  const parts = lower.split("+").map(p => p.trim());
  if (parts.every(p => NATIVE_ONLY_TOKENS.has(p))) return true;
  if (parts.length === 1 && /^f\d{1,2}$/.test(lower)) return true;
  return false;
}

export function toElectronAccelerator(combo: string): string {
  return combo
    .replace(/cmd/gi, "Command").replace(/command/gi, "Command")
    .replace(/option/gi, "Alt").replace(/opt\b/gi, "Alt")
    .replace(/ctrl\b/gi, "Ctrl").replace(/control\b/gi, "Ctrl")
    .replace(/shift/gi, "Shift").replace(/alt\b/gi, "Alt")
    .replace(/super\b/gi, "Super").replace(/space\b/gi, "Space")
    .replace(/return\b/gi, "Return").replace(/enter\b/gi, "Return")
    .replace(/tab\b/gi, "Tab").replace(/esc\b/gi, "Escape")
    .replace(/escape\b/gi, "Escape").replace(/up\b/gi, "Up")
    .replace(/down\b/gi, "Down").replace(/left\b/gi, "Left")
    .replace(/right\b/gi, "Right")
    .split("+").map((part) => part.trim()).join("+");
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
  private rejectedPress = false;

  constructor(
    private readonly settingsProvider: () => Settings,
    private readonly onPress: (source: "hotkey" | "tray") => void | boolean,
    private readonly onRelease: () => void,
    private readonly onCancel: () => void,
    private readonly onPasteLatest: () => void,
    private readonly onPrimaryHotkeyUnavailable: (message: string) => void
  ) {}

  register(): void {
    if (this.captureActive) return;

    this.stopMonitors();
    const settings = this.settingsProvider();
    this.registerPasteLatest(settings.pasteLatestHotkey);

    const primary = parseHotkey(settings.primaryHotkey);
    if (!primary.ok) {
      console.warn("[vaani] primary dictation hotkey refused:", settings.primaryHotkey);
      this.onPrimaryHotkeyUnavailable(primary.message);
      return;
    }

    const started = nativeBridge.startHotkeyMonitor?.(
      primary.hotkey,
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

  isPrimaryHotkeyActive(): boolean {
    return this.usingNativeMonitor;
  }

  setCaptureActive(active: boolean): void {
    if (this.captureActive === active) return;
    this.captureActive = active;
    if (active) { this.stopMonitors(); return; }
    this.register();
  }

  // Tray start uses the hotkey press path, then locks on because no key release will stop it.
  startFromMenu(): void {
    if (this.onPress("tray") === false) return;
    this.enterToggleMode();
  }

  // Tray stop ends the session the same way a toggle press does.
  stopFromMenu(): void {
    this.exitToggleMode(false);
  }

  // Drops a hands-free lock once its recording ended on its own, so Escape is released and the next press starts fresh.
  syncSession(capturing: boolean): void {
    if (capturing || !this.isToggleRecording) return;
    this.isToggleRecording = false;
    this.unregisterEscapeShortcut();
    this.clearPendingRelease();
  }

  // Full teardown for app quit. Drops any toggle or Escape state.
  unregister(): void {
    this.clearPendingRelease();
    this.unregisterEscapeShortcut();
    this.isToggleRecording = false;
    this.suppressNextRelease = false;
    this.rejectedPress = false;
    this.stopMonitors();
  }

  // Stops native monitors and paste-latest only. Toggle and Escape state survive so an active recording can still be stopped.
  private stopMonitors(): void {
    if (this.usingNativeMonitor) {
      try { nativeBridge.stopHotkeyMonitor?.(); } catch (error) { console.warn("[vaani] failed to stop native hotkey monitor:", error); }
      this.usingNativeMonitor = false;
    }

    if (this.usingNativePasteMonitor) {
      try { nativeBridge.stopPasteLatestMonitor?.(); } catch (error) { console.warn("[vaani] failed to stop native paste latest monitor:", error); }
      this.usingNativePasteMonitor = false;
    }

    if (this.pasteLatestAccelerator) {
      globalShortcut.unregister(this.pasteLatestAccelerator);
      this.pasteLatestAccelerator = null;
    }
  }

  private registerPasteLatest(combo: string): void {
    if (!combo) return;

    const parsed = parseHotkey(combo);
    if (!parsed.ok) {
      console.warn("[vaani] paste latest hotkey refused:", parsed.message);
      return;
    }
    const hotkey = parsed.hotkey;

    const startedNative = nativeBridge.startPasteLatestMonitor?.(hotkey, () => this.onPasteLatest()) ?? false;
    if (startedNative) {
      this.usingNativePasteMonitor = true;
      this.pasteLatestAccelerator = null;
      return;
    }

    if (isNativeOnlyAccelerator(hotkey)) {
      console.warn("[vaani] paste latest hotkey is native-only, skipping Electron globalShortcut:", hotkey);
      return;
    }

    const accelerator = toElectronAccelerator(hotkey);
    try {
      const ok = globalShortcut.register(accelerator, () => this.onPasteLatest());
      if (ok) { this.pasteLatestAccelerator = accelerator; }
      else { console.warn("[vaani] could not register paste latest hotkey:", accelerator); }
    } catch (error) { console.warn("[vaani] paste latest hotkey register error:", error); }
  }

  private handlePress(): void {
    if (this.rejectedPress) return;

    const settings = this.settingsProvider();
    const mode: DictationMode = settings.dictationMode || "toggle";
    const now = Date.now();

    // Any press during a toggle recording ends it. Releases never do.
    if (this.isToggleRecording) {
      this.suppressNextRelease = true;
      this.exitToggleMode(false);
      return;
    }

    // Smart toggle: a second tap inside the window locks recording on.
    if (this.pendingReleaseTimer) {
      this.clearPendingRelease();
      this.enterToggleMode();
      this.lastPressTime = now;
      return;
    }

    if (this.onPress("hotkey") === false) {
      this.rejectedPress = true;
      return;
    }
    this.lastPressTime = now;
    if (mode === "toggle") this.enterToggleMode();
  }

  private handleRelease(): void {
    if (this.rejectedPress) {
      this.rejectedPress = false;
      return;
    }

    const settings = this.settingsProvider();
    const mode: DictationMode = settings.dictationMode || "toggle";

    if (this.suppressNextRelease) {
      this.suppressNextRelease = false;
      return;
    }

    // Push-to-talk: stop immediately on release
    if (mode === "push-to-talk") {
      this.onRelease();
      return;
    }

    // Toggle recordings end on the next press, so a release never stops them.
    if (this.isToggleRecording || mode === "toggle") return;

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
    if (cancel) { this.onCancel(); return; }
    this.onRelease();
  }

  private registerEscapeShortcut(): void {
    if (this.escapeRegistered) return;
    try {
      this.escapeRegistered = globalShortcut.register("Escape", () => this.exitToggleMode(true));
    } catch (error) { console.warn("[vaani] escape shortcut register error:", error); }
  }

  private unregisterEscapeShortcut(): void {
    if (!this.escapeRegistered) return;
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
