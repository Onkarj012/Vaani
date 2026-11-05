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
      handle: vi.fn(),
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
    setWindowOpenHandler: vi.fn(),
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
  setBounds = vi.fn<(bounds: { x: number; y: number; width: number; height: number }) => void>();
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

    controller.setRecording("s1");
    await Promise.resolve();
    await Promise.resolve();

    const win = windows[0];
    if (!win) throw new Error("Expected overlay window.");
    win.webContents.ipc.handlers.get("capsule:ready")?.();
    await Promise.resolve();

    expect(win.showInactive).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith("capsule:set-mode", "recording");
  });

  it("clears a pending delayed hide when destroyed", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();

    controller.setRecording("s1");
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

  it("clears status text on hide and on new recording modes", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    controller.setRecording("s1");
    await Promise.resolve();
    await Promise.resolve();
    const win = windows[0];
    if (!win) throw new Error("Expected overlay window.");
    win.webContents.ipc.handlers.get("capsule:ready")?.();
    await Promise.resolve();

    controller.setStatusMessage("Old failure", { reason: "timeout" });
    expect(win.webContents.send).toHaveBeenLastCalledWith("capsule:set-status", { message: "Old failure", reason: "timeout", insertion: null });
    const beforeHide = win.webContents.send.mock.calls.filter(([channel]) => channel === "capsule:set-status").length;
    controller.hide();
    expect(win.webContents.send.mock.calls.filter(([channel]) => channel === "capsule:set-status").slice(beforeHide)).toEqual([["capsule:set-status", null]]);

    controller.setStatusMessage("Old failure");
    const beforePressed = win.webContents.send.mock.calls.filter(([channel]) => channel === "capsule:set-status").length;
    controller.setPressed();
    expect(win.webContents.send.mock.calls.filter(([channel]) => channel === "capsule:set-status").slice(beforePressed)).toEqual([["capsule:set-status", null]]);
    controller.setStatusMessage("Old failure");
    const beforeRecording = win.webContents.send.mock.calls.filter(([channel]) => channel === "capsule:set-status").length;
    controller.setRecording("s1");
    expect(win.webContents.send.mock.calls.filter(([channel]) => channel === "capsule:set-status").slice(beforeRecording)).toEqual([["capsule:set-status", null]]);
  });

  it("resends hands-free state after each mode update so a replayed pressed cannot hide the controls", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    controller.setRecording("s1");
    await Promise.resolve();
    await Promise.resolve();
    const win = windows[0];
    if (!win) throw new Error("Expected overlay window.");
    win.webContents.ipc.handlers.get("capsule:ready")?.();
    await Promise.resolve();

    controller.setHandsFree(true);
    win.webContents.send.mockClear();
    controller.setPressed();
    vi.advanceTimersByTime(200);

    const sent = win.webContents.send.mock.calls.filter(([channel]) => channel === "capsule:set-mode" || channel === "capsule:set-hands-free");
    expect(sent.at(-1)).toEqual(["capsule:set-hands-free", true]);
  });

  it("sends the recording session id to the overlay", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    controller.setRecording("s1");
    await Promise.resolve();
    await Promise.resolve();
    const win = windows[0];
    if (!win) throw new Error("Expected overlay window.");
    win.webContents.ipc.handlers.get("capsule:ready")?.();
    await Promise.resolve();

    controller.setHandsFree(true);
    expect(win.webContents.send).toHaveBeenLastCalledWith("capsule:set-session", "s1");
  });

  it("holds Cancelled on screen even when dictation resets right away", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    controller.setRecording("s1");
    await Promise.resolve();
    await Promise.resolve();
    const win = windows[0];
    if (!win) throw new Error("Expected overlay window.");
    win.webContents.ipc.handlers.get("capsule:ready")?.();
    await Promise.resolve();

    controller.setCancelled();
    controller.hide();
    expect(win.webContents.send).toHaveBeenCalledWith("capsule:set-mode", "cancelled");
    expect(win.webContents.send).not.toHaveBeenCalledWith("capsule:set-mode", "idle");

    vi.advanceTimersByTime(899);
    expect(win.webContents.send).not.toHaveBeenCalledWith("capsule:set-mode", "idle");
    vi.advanceTimersByTime(1 + 250);
    expect(win.webContents.send).toHaveBeenCalledWith("capsule:set-mode", "idle");
    expect(win.hide).toHaveBeenCalled();
  });

  it("keeps a success note up past the 600 ms reset, and a new press clears the hold", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    controller.setRecording("s1");
    await Promise.resolve();
    await Promise.resolve();
    const win = windows[0];
    if (!win) throw new Error("Expected overlay window.");
    win.webContents.ipc.handlers.get("capsule:ready")?.();
    await Promise.resolve();

    controller.setStatusMessage("Copied. Paste when ready.", { insertion: "copy-only" });
    controller.setSuccess();
    vi.advanceTimersByTime(600);
    controller.setStatusMessage(null);
    controller.hide();
    expect(win.webContents.send).not.toHaveBeenCalledWith("capsule:set-mode", "idle");
    expect(win.webContents.send).not.toHaveBeenCalledWith("capsule:set-status", null);

    vi.advanceTimersByTime(1_400);
    expect(win.webContents.send).toHaveBeenCalledWith("capsule:set-status", null);
    expect(win.webContents.send).toHaveBeenCalledWith("capsule:set-mode", "idle");

    controller.setStatusMessage("Copied. Paste when ready.");
    controller.setSuccess();
    controller.setPressed();
    expect(win.webContents.send).toHaveBeenLastCalledWith("capsule:set-session", null);
    expect(win.webContents.send).toHaveBeenCalledWith("capsule:set-mode", "pressed");
  });

  it("uses one capsule window size for every non-prompt state", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    controller.setRecording("s1");
    await Promise.resolve();
    await Promise.resolve();
    const win = windows[0];
    if (!win) throw new Error("Expected overlay window.");
    win.webContents.ipc.handlers.get("capsule:ready")?.();
    await Promise.resolve();

    controller.setHandsFree(true);
    controller.setStatusMessage("Transcription timed out. Please try again.", { reason: "timeout" });
    controller.setError();
    controller.hide();
    const sizes = new Set(win.setBounds.mock.calls.map(([bounds]) => `${bounds.width}x${bounds.height}`));
    expect([...sizes]).toEqual(["440x104"]);
  });
});
