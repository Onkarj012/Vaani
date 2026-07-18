import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

const windows: BrowserWindowMock[] = [];

class BrowserWindowMock {
  webContents = {
    ipc: {
      handlers: new Map<string, Handler>(),
      on: vi.fn((channel: string, handler: Handler) => {
        this.webContents.ipc.handlers.set(channel, handler);
      }),
      once: vi.fn(),
      removeListener: vi.fn(),
    },
    handlers: new Map<string, Handler>(),
    on: vi.fn((channel: string, handler: Handler) => {
      this.webContents.handlers.set(channel, handler);
    }),
    send: vi.fn(),
    isCrashed: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    getURL: vi.fn(() => "test://overlay"),
    forcefullyCrashRenderer: vi.fn(),
  };
  hidden = false;
  destroyed = false;
  visible = false;
  excludedFromShownWindowsMenu = false;
  hide = vi.fn(() => { this.hidden = true; this.visible = false; });
  destroy = vi.fn(() => { this.destroyed = true; });
  showInactive = vi.fn(() => { this.visible = true; });
  focus = vi.fn();
  on = vi.fn();
  setBounds = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  setAlwaysOnTop = vi.fn();
  setIgnoreMouseEvents = vi.fn();
  setFocusable = vi.fn();

  constructor() {
    windows.push(this);
  }

  isDestroyed(): boolean { return this.destroyed; }
  isVisible(): boolean { return this.visible; }
  loadFile(): Promise<void> { return Promise.resolve(); }
  loadURL(): Promise<void> { return Promise.resolve(); }
}

vi.mock("electron", () => ({
  app: { dock: { show: () => Promise.resolve(), hide: () => {} } },
  BrowserWindow: BrowserWindowMock,
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
}));

vi.mock("@main/nativeBridge", () => ({
  nativeBridge: {
    getFrontmostApplication: () => ({ bundleId: "com.apple.TextEdit", name: "TextEdit" }),
  },
}));

describe("OverlayController lifecycle characterization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("OVERLAY_WINDOW_VITE_NAME", "overlay_window");
    windows.length = 0;
  });

  it("creates and presents the overlay for recording mode after renderer readiness", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();

    controller.setRecording();
    await Promise.resolve();
    await Promise.resolve();

    const win = windows[0];
    if (!win) throw new Error("Expected overlay window.");
    win.webContents.ipc.handlers.get("capsule:ready")?.();
    await Promise.resolve();

    expect(win.showInactive).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith("capsule:snapshot", {
      mode: "recording",
      bars: null,
      accent: "#FF006E",
    });
  });

  it("clears a pending delayed hide when destroyed", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();

    controller.setRecording();
    await Promise.resolve();
    await Promise.resolve();
    const win = windows[0];
    if (!win) throw new Error("Expected overlay window.");
    win.webContents.ipc.handlers.get("capsule:ready")?.();
    await Promise.resolve();

    controller.hide();
    controller.destroy();
    vi.advanceTimersByTime(300);

    expect(win.destroy).toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it("recovers the window when capsule:ready never arrives after the page finishes loading", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();

    controller.setRecording();
    await Promise.resolve();
    await Promise.resolve();

    const win = windows[0];
    if (!win) throw new Error("Expected overlay window.");

    // Page finished loading but the renderer never sent capsule:ready
    // (e.g. it crashed before React mounted) — must not be treated as ready.
    win.webContents.handlers.get("did-finish-load")?.();
    await vi.advanceTimersByTimeAsync(400);

    expect(win.destroy).toHaveBeenCalled();
    expect(windows.length).toBe(2);
  });

  it("re-asserts always-on-top and workspace visibility on every show, not just the first", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();

    controller.setRecording();
    await Promise.resolve();
    await Promise.resolve();

    const win = windows[0];
    if (!win) throw new Error("Expected overlay window.");
    win.webContents.ipc.handlers.get("capsule:ready")?.();
    await Promise.resolve();

    win.setAlwaysOnTop.mockClear();
    win.setVisibleOnAllWorkspaces.mockClear();
    win.setBounds.mockClear();

    controller.setRecording();

    expect(win.setAlwaysOnTop).toHaveBeenCalled();
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalled();
    expect(win.setBounds).toHaveBeenCalled();
  });
});
