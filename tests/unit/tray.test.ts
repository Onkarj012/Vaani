import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrayOptions } from "@main/tray";

const hoisted = vi.hoisted(() => {
  const trayHandlers: Record<string, (...args: unknown[]) => void> = {};
  const popUpContextMenu = vi.fn();
  let lastTemplate: any[] = [];
  return {
    trayHandlers,
    popUpContextMenu,
    getLastTemplate: () => lastTemplate,
    setLastTemplate: (t: any[]) => { lastTemplate = t; },
  };
});

vi.mock("electron", () => {
  class Tray {
    popUpContextMenu = hoisted.popUpContextMenu;
    on(event: string, cb: (...args: unknown[]) => void) { hoisted.trayHandlers[event] = cb; }
    setToolTip() {}
    setIgnoreDoubleClickEvents() {}
    destroy() {}
  }
  const Menu = {
    buildFromTemplate: (t: any[]) => { hoisted.setLastTemplate(t); return { items: t }; },
  };
  const nativeImage = {
    createFromPath: () => ({ isEmpty: () => true, resize: () => ({ setTemplateImage() {} }), setTemplateImage() {} }),
    createFromDataURL: () => ({ setTemplateImage() {} }),
  };
  const app = { getVersion: () => "1.0.0", setAboutPanelOptions() {}, showAboutPanel() {} };
  return { Tray, Menu, nativeImage, app };
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function makeOptions(overrides: Partial<TrayOptions> = {}): TrayOptions {
  return {
    openMainWindow: vi.fn(),
    quit: vi.fn(),
    startDictation: vi.fn(),
    pasteLatest: vi.fn(),
    getRecentHistory: async () => [],
    reinjectEntry: vi.fn(),
    getLanguage: () => "auto",
    setLanguage: vi.fn(),
    ...overrides,
  };
}

function findItem(label: string) {
  return hoisted.getLastTemplate().find((i) => i.label === label);
}

describe("menuShortcutHint", () => {
  it("returns the canonical hotkey for keys the menu can draw", async () => {
    const { menuShortcutHint } = await import("@main/tray");
    expect(menuShortcutHint("ctrl+cmd+v")).toBe("Ctrl+Cmd+V");
    expect(menuShortcutHint("Option+Space")).toBe("Option+Space");
  });

  it("returns undefined for Fn, empty, or invalid hotkeys", async () => {
    const { menuShortcutHint } = await import("@main/tray");
    expect(menuShortcutHint("Fn")).toBeUndefined();
    expect(menuShortcutHint("")).toBeUndefined();
    expect(menuShortcutHint("Cmd+Shift")).toBeUndefined();
  });
});

describe("createTray", () => {
  beforeEach(async () => {
    hoisted.popUpContextMenu.mockClear();
    hoisted.setLastTemplate([]);
    const { createTray } = await import("@main/tray");
    void createTray; // ensure module loaded
  });

  it("opens the menu on left click instead of the main window", async () => {
    const { createTray } = await import("@main/tray");
    const openMainWindow = vi.fn();
    createTray(makeOptions({ openMainWindow }));

    hoisted.trayHandlers["click"]!();
    await flush();

    expect(hoisted.popUpContextMenu).toHaveBeenCalledTimes(1);
    expect(openMainWindow).not.toHaveBeenCalled();
  });

  it("includes a Language submenu", async () => {
    const { createTray } = await import("@main/tray");
    createTray(makeOptions());

    hoisted.trayHandlers["click"]!();
    await flush();

    const language = findItem("Language");
    expect(language?.submenu?.length).toBeGreaterThan(0);
  });

  it("shows at most 10 recent-history items", async () => {
    const { createTray } = await import("@main/tray");
    const recent = Array.from({ length: 15 }, (_, i) => ({ id: `id${i}`, cleanedText: `text ${i}` }));
    createTray(makeOptions({ getRecentHistory: async () => recent }));

    hoisted.trayHandlers["click"]!();
    await flush();

    const history = findItem("Recent History");
    expect(history?.submenu?.length).toBe(10);
  });

  it("calls setLanguage with the expected code when a language item is clicked", async () => {
    const { createTray } = await import("@main/tray");
    const setLanguage = vi.fn();
    createTray(makeOptions({ setLanguage }));

    hoisted.trayHandlers["click"]!();
    await flush();

    const hindi = findItem("Language").submenu.find((i: { label: string }) => i.label === "Hindi");
    hindi.click();
    expect(setLanguage).toHaveBeenCalledWith("hi");
  });

  it("re-injects the clicked recent-history entry", async () => {
    const { createTray } = await import("@main/tray");
    const reinjectEntry = vi.fn();
    createTray(makeOptions({
      getRecentHistory: async () => [{ id: "abc", cleanedText: "hello world" }],
      reinjectEntry,
    }));

    hoisted.trayHandlers["click"]!();
    await flush();

    const history = findItem("Recent History");
    history.submenu[0].click();
    expect(reinjectEntry).toHaveBeenCalledWith("abc");
  });

  it("shows no shortcut hint on Open Vaani, since none is registered", async () => {
    const { createTray } = await import("@main/tray");
    createTray(makeOptions());

    hoisted.trayHandlers["click"]!();
    await flush();

    expect(findItem("Open Vaani").accelerator).toBeUndefined();
  });

  it("shows the saved Paste Latest hotkey as a display-only hint", async () => {
    const { createTray } = await import("@main/tray");
    createTray(makeOptions({ getPasteLatestHotkey: () => "ctrl+cmd+v" }));

    hoisted.trayHandlers["click"]!();
    await flush();

    const paste = findItem("Paste Latest");
    expect(paste.accelerator).toBe("Ctrl+Cmd+V");
    expect(paste.registerAccelerator).toBe(false);
  });

  it("reads the Paste Latest hotkey each time the menu opens", async () => {
    const { createTray } = await import("@main/tray");
    let hotkey = "Ctrl+Cmd+V";
    createTray(makeOptions({ getPasteLatestHotkey: () => hotkey }));

    hoisted.trayHandlers["click"]!();
    await flush();
    expect(findItem("Paste Latest").accelerator).toBe("Ctrl+Cmd+V");

    hotkey = "Cmd+Shift+L";
    await new Promise((r) => setTimeout(r, 350)); // past the menu debounce
    hoisted.trayHandlers["click"]!();
    await flush();
    expect(findItem("Paste Latest").accelerator).toBe("Cmd+Shift+L");
  });

  it("shows a disabled placeholder when history is empty", async () => {
    const { createTray } = await import("@main/tray");
    createTray(makeOptions({ getRecentHistory: async () => [] }));

    hoisted.trayHandlers["click"]!();
    await flush();

    const history = findItem("Recent History");
    expect(history.submenu).toHaveLength(1);
    expect(history.submenu[0].enabled).toBe(false);
  });
});
