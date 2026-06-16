import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
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
      () => ({ ...DEFAULT_SETTINGS, primaryHotkey: "Cmd+D" }),
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

  it("cancels toggle recording when Escape is pressed", async () => {
    startHotkeyMonitorMock.mockReturnValue(true);
    startPasteLatestMonitorMock.mockReturnValue(true);
    const onCancel = vi.fn();
    const { HotkeyManager } = await import("@main/hotkeys");

    const manager = new HotkeyManager(
      () => ({ ...DEFAULT_SETTINGS, primaryHotkey: "Cmd+D" }),
      vi.fn(),
      vi.fn(),
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

    const registeredShortcuts = registerMock.mock.calls as unknown as Array<[string, () => void]>;
    const escapeHandler = registeredShortcuts.find(([accelerator]) => accelerator === "Escape")?.[1];
    if (!escapeHandler) throw new Error("Escape handler was not registered.");
    escapeHandler();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(unregisterMock).toHaveBeenCalledWith("Escape");
    dateNowSpy.mockRestore();
  });
});
