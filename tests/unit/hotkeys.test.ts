import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import { hotkeyFromKeyEvent, isCanonicalHotkey, parseHotkey } from "@shared/hotkeys";
import type { Settings } from "@shared/types";

const registerMock = vi.fn(() => true);
const unregisterMock = vi.fn();
const startHotkeyMonitorMock = vi.fn();
const stopHotkeyMonitorMock = vi.fn();
const startPasteLatestMonitorMock = vi.fn();
const stopPasteLatestMonitorMock = vi.fn();

vi.mock("electron", () => ({
  globalShortcut: {
    register: registerMock,
    unregister: unregisterMock
  }
}));

vi.mock("@main/nativeBridge", () => ({
  nativeBridge: {
    startHotkeyMonitor: startHotkeyMonitorMock,
    stopHotkeyMonitor: stopHotkeyMonitorMock,
    startPasteLatestMonitor: startPasteLatestMonitorMock,
    stopPasteLatestMonitor: stopPasteLatestMonitorMock
  }
}));

describe("HotkeyManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    registerMock.mockClear();
    unregisterMock.mockClear();
    startHotkeyMonitorMock.mockClear();
    stopHotkeyMonitorMock.mockClear();
    startPasteLatestMonitorMock.mockClear();
    stopPasteLatestMonitorMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers the native hold-to-record hotkey and paste-latest shortcut", async () => {
    startHotkeyMonitorMock.mockReturnValue(true);
    startPasteLatestMonitorMock.mockReturnValue(true);
    const { HotkeyManager } = await import("@main/hotkeys");
    const settings: Settings = { ...DEFAULT_SETTINGS, primaryHotkey: "Cmd+D", pasteLatestHotkey: "Ctrl+Cmd+V" };

    const manager = new HotkeyManager(
      () => settings,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn()
    );

    manager.register();

    expect(startHotkeyMonitorMock).toHaveBeenCalledWith("Cmd+D", expect.any(Function));
    expect(startPasteLatestMonitorMock).toHaveBeenCalledWith("Ctrl+Cmd+V", expect.any(Function));
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("surfaces an explicit error when the native hotkey monitor is unavailable", async () => {
    startHotkeyMonitorMock.mockReturnValue(false);
    startPasteLatestMonitorMock.mockReturnValue(true);
    const unavailable = vi.fn();
    const { HotkeyManager } = await import("@main/hotkeys");

    const manager = new HotkeyManager(
      () => ({ ...DEFAULT_SETTINGS, primaryHotkey: "Cmd+D" }),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      unavailable
    );

    manager.register();

    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(startPasteLatestMonitorMock).toHaveBeenCalledTimes(1);
  });

  it("reregisters the paste-latest hotkey when settings change", async () => {
    startHotkeyMonitorMock.mockReturnValue(true);
    startPasteLatestMonitorMock.mockReturnValue(true);
    const { HotkeyManager, toElectronAccelerator } = await import("@main/hotkeys");
    const settings: Settings = { ...DEFAULT_SETTINGS, pasteLatestHotkey: "Ctrl+Cmd+V" };

    const manager = new HotkeyManager(
      () => settings,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn()
    );

    manager.register();
    settings.pasteLatestHotkey = "Cmd+Shift+V";
    manager.reregister();

    expect(stopPasteLatestMonitorMock).toHaveBeenCalledTimes(1);
    expect(startPasteLatestMonitorMock).toHaveBeenLastCalledWith("Cmd+Shift+V", expect.any(Function));
    expect(unregisterMock).not.toHaveBeenCalledWith(toElectronAccelerator("Ctrl+Cmd+V"));
  });

  it("keeps recording active after a quick double press and stops on the next press", async () => {
    startHotkeyMonitorMock.mockReturnValue(true);
    startPasteLatestMonitorMock.mockReturnValue(true);
    const onPress = vi.fn();
    const onRelease = vi.fn();
    const onCancel = vi.fn();
    const { HotkeyManager } = await import("@main/hotkeys");

    const manager = new HotkeyManager(
      () => ({ ...DEFAULT_SETTINGS, primaryHotkey: "Cmd+D", dictationMode: "toggle-double" }),
      onPress,
      onRelease,
      onCancel,
      vi.fn(),
      vi.fn()
    );

    manager.register();
    const callback = startHotkeyMonitorMock.mock.calls[0]?.[1] as ((pressed: boolean) => void);
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy.mockReturnValue(0);
    callback(true);
    callback(false);
    vi.advanceTimersByTime(100);
    dateNowSpy.mockReturnValue(100);
    callback(true);
    callback(false);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();
    expect(registerMock).toHaveBeenCalledWith("Escape", expect.any(Function));

    dateNowSpy.mockReturnValue(1_000);
    callback(true);
    callback(false);

    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    dateNowSpy.mockRestore();
  });

  it("locks smart toggle recording on a fast down-up-down-up with immediate releases", async () => {
    startHotkeyMonitorMock.mockReturnValue(true);
    startPasteLatestMonitorMock.mockReturnValue(true);
    const onPress = vi.fn();
    const onRelease = vi.fn();
    const { HotkeyManager } = await import("@main/hotkeys");
    const manager = new HotkeyManager(
      () => ({ ...DEFAULT_SETTINGS, dictationMode: "toggle-double" }),
      onPress,
      onRelease,
      vi.fn(),
      vi.fn(),
      vi.fn()
    );

    manager.register();
    const callback = startHotkeyMonitorMock.mock.calls[0]?.[1] as ((pressed: boolean) => void);
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy.mockReturnValue(0);
    callback(true);
    callback(false);
    dateNowSpy.mockReturnValue(120);
    callback(true);
    callback(false);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();
    dateNowSpy.mockRestore();
  });

  it("smart toggle stops on release after a long hold", async () => {
    startHotkeyMonitorMock.mockReturnValue(true);
    startPasteLatestMonitorMock.mockReturnValue(true);
    const onRelease = vi.fn();
    const { HotkeyManager } = await import("@main/hotkeys");
    const manager = new HotkeyManager(
      () => ({ ...DEFAULT_SETTINGS, dictationMode: "toggle-double" }),
      vi.fn(),
      onRelease,
      vi.fn(),
      vi.fn(),
      vi.fn()
    );

    manager.register();
    const callback = startHotkeyMonitorMock.mock.calls[0]?.[1] as ((pressed: boolean) => void);
    const dateNowSpy = vi.spyOn(Date, "now");
    dateNowSpy.mockReturnValue(0);
    callback(true);
    dateNowSpy.mockReturnValue(1_000);
    callback(false);

    expect(onRelease).toHaveBeenCalledTimes(1);
    dateNowSpy.mockRestore();
  });

  it("toggle mode ignores releases and stops on the next press", async () => {
    startHotkeyMonitorMock.mockReturnValue(true);
    startPasteLatestMonitorMock.mockReturnValue(true);
    const onPress = vi.fn();
    const onRelease = vi.fn();
    const { HotkeyManager } = await import("@main/hotkeys");
    const manager = new HotkeyManager(
      () => ({ ...DEFAULT_SETTINGS, dictationMode: "toggle" }),
      onPress,
      onRelease,
      vi.fn(),
      vi.fn(),
      vi.fn()
    );

    manager.register();
    const callback = startHotkeyMonitorMock.mock.calls[0]?.[1] as ((pressed: boolean) => void);
    callback(true);
    callback(false);
    vi.advanceTimersByTime(5_000);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();

    callback(true);
    callback(false);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("cancels toggle recording when Escape is pressed", async () => {
    startHotkeyMonitorMock.mockReturnValue(true);
    startPasteLatestMonitorMock.mockReturnValue(true);
    const onCancel = vi.fn();
    const { HotkeyManager } = await import("@main/hotkeys");

    const manager = new HotkeyManager(
      () => ({ ...DEFAULT_SETTINGS, primaryHotkey: "Cmd+D", dictationMode: "toggle" }),
      vi.fn(),
      vi.fn(),
      onCancel,
      vi.fn(),
      vi.fn()
    );

    manager.register();
    const callback = startHotkeyMonitorMock.mock.calls[0]?.[1] as ((pressed: boolean) => void);
    callback(true);
    callback(false);

    const registeredShortcuts = registerMock.mock.calls as unknown as Array<[string, () => void]>;
    const escapeHandler = registeredShortcuts.find(([accelerator]) => accelerator === "Escape")?.[1];
    if (!escapeHandler) throw new Error("Escape handler was not registered.");
    escapeHandler();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(unregisterMock).toHaveBeenCalledWith("Escape");
  });

  it("does not release or enter toggle mode after a rejected press", async () => {
    startHotkeyMonitorMock.mockReturnValue(true);
    startPasteLatestMonitorMock.mockReturnValue(true);
    const onPress = vi.fn(() => false);
    const onRelease = vi.fn();
    const { HotkeyManager } = await import("@main/hotkeys");
    const manager = new HotkeyManager(
      () => ({ ...DEFAULT_SETTINGS, dictationMode: "toggle" }),
      onPress,
      onRelease,
      vi.fn(),
      vi.fn(),
      vi.fn()
    );

    manager.register();
    const callback = startHotkeyMonitorMock.mock.calls[0]?.[1] as ((pressed: boolean) => void);
    callback(true);
    callback(false);
    vi.advanceTimersByTime(400);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalledWith("Escape", expect.any(Function));

    onPress.mockReturnValue(true);
    callback(true);
    callback(false);
    vi.advanceTimersByTime(400);
    expect(onPress).toHaveBeenCalledTimes(2);
    expect(onRelease).not.toHaveBeenCalled();

    callback(true);
    callback(false);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("refuses a stored primary hotkey native code cannot register", async () => {
    startHotkeyMonitorMock.mockReturnValue(true);
    startPasteLatestMonitorMock.mockReturnValue(true);
    const unavailable = vi.fn();
    const { HotkeyManager } = await import("@main/hotkeys");
    const manager = new HotkeyManager(
      () => ({ ...DEFAULT_SETTINGS, primaryHotkey: "Fn+D" }),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      unavailable
    );

    manager.register();

    expect(startHotkeyMonitorMock).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledWith(expect.stringContaining("Fn works only by itself"));
  });

  it("hands native code the canonical accelerator", async () => {
    startHotkeyMonitorMock.mockReturnValue(true);
    startPasteLatestMonitorMock.mockReturnValue(true);
    const { HotkeyManager } = await import("@main/hotkeys");
    const manager = new HotkeyManager(
      () => ({ ...DEFAULT_SETTINGS, primaryHotkey: "alt+ArrowRight", pasteLatestHotkey: "control+command+v" }),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn()
    );

    manager.register();

    expect(startHotkeyMonitorMock).toHaveBeenCalledWith("Option+Right", expect.any(Function));
    expect(startPasteLatestMonitorMock).toHaveBeenCalledWith("Ctrl+Cmd+V", expect.any(Function));
  });

  it("allows the next push-to-talk press after a rejected press", async () => {
    startHotkeyMonitorMock.mockReturnValue(true);
    startPasteLatestMonitorMock.mockReturnValue(true);
    const onPress = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const onRelease = vi.fn();
    const { HotkeyManager } = await import("@main/hotkeys");
    const manager = new HotkeyManager(
      () => ({ ...DEFAULT_SETTINGS, dictationMode: "push-to-talk" }),
      onPress,
      onRelease,
      vi.fn(),
      vi.fn(),
      vi.fn()
    );

    manager.register();
    const callback = startHotkeyMonitorMock.mock.calls[0]?.[1] as ((pressed: boolean) => void);
    callback(true);
    callback(false);
    callback(true);
    callback(false);

    expect(onPress).toHaveBeenCalledTimes(2);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});

describe("parseHotkey", () => {
  it("keeps canonical names and maps aliases to them", () => {
    expect(parseHotkey("Control+Command+ArrowUp")).toEqual({ ok: true, hotkey: "Ctrl+Cmd+Up" });
    expect(parseHotkey("option+d")).toEqual({ ok: true, hotkey: "Option+D" });
    expect(parseHotkey("enter")).toEqual({ ok: true, hotkey: "Return" });
  });

  it("accepts Fn only by itself", () => {
    expect(parseHotkey("fn")).toEqual({ ok: true, hotkey: "Fn" });
    expect(parseHotkey("Fn+D").ok).toBe(false);
  });

  it("refuses modifier-only and unregistrable keys with a reason", () => {
    const modifierOnly = parseHotkey("Cmd+Shift");
    expect(modifierOnly.ok).toBe(false);
    expect(modifierOnly.ok ? "" : modifierOnly.message).toContain("modifier-only");

    const backspace = parseHotkey("Backspace");
    expect(backspace.ok).toBe(false);
    expect(backspace.ok ? "" : backspace.message).toContain("\"Backspace\" can't be used");
  });

  it("refuses two keys in one hotkey", () => {
    expect(parseHotkey("Cmd+D+E").ok).toBe(false);
  });

  it("only treats already canonical strings as canonical", () => {
    expect(isCanonicalHotkey("Ctrl+Cmd+V")).toBe(true);
    expect(isCanonicalHotkey("Alt+d")).toBe(false);
    expect(isCanonicalHotkey("⌘D")).toBe(false);
  });

  it("builds hotkeys from key presses using the physical key", () => {
    expect(hotkeyFromKeyEvent({ key: "∂", code: "KeyD", metaKey: false, ctrlKey: false, altKey: true, shiftKey: false }))
      .toEqual({ ok: true, hotkey: "Option+D" });
    expect(hotkeyFromKeyEvent({ key: " ", code: "Space", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }))
      .toEqual({ ok: true, hotkey: "Cmd+Space" });
  });
});
