import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

const windows: BrowserWindowMock[] = [];

class BrowserWindowMock {
  webContents = {
    ipc: {
      handlers: new Map<string, Handler>(),
      once: vi.fn((channel: string, handler: Handler) => {
        this.webContents.ipc.handlers.set(channel, handler);
      }),
      on: vi.fn((channel: string, handler: Handler) => {
        this.webContents.ipc.handlers.set(channel, handler);
      }),
      removeListener: vi.fn((channel: string) => {
        this.webContents.ipc.handlers.delete(channel);
      }),
    },
    on: vi.fn(),
    send: vi.fn(),
    isCrashed: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    getURL: vi.fn(() => "test://overlay"),
    forcefullyCrashRenderer: vi.fn(),
  };
  excludedFromShownWindowsMenu = false;

  constructor() {
    windows.push(this);
  }

  isDestroyed(): boolean { return false; }
  isVisible(): boolean { return false; }
  destroy(): void {}
  hide(): void {}
  showInactive(): void {}
  focus(): void {}
  on(): void {}
  setBounds(): void {}
  setVisibleOnAllWorkspaces(): void {}
  setAlwaysOnTop(): void {}
  setIgnoreMouseEvents(): void {}
  setFocusable(): void {}
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
    getFrontmostApplication: () => ({ bundleId: "com.test.App", name: "Test App" }),
  },
}));

describe("OverlayController prompt handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("OVERLAY_WINDOW_VITE_NAME", "overlay_window");
    windows.length = 0;
  });

  it("registers the snippet response listener after async window creation and before showing the prompt", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    const onResponse = vi.fn();

    controller.showSnippetPrompt("email", onResponse);
    await Promise.resolve();
    await Promise.resolve();

    const win = windows[0];
    if (!win) throw new Error("Expected overlay window to be created.");
    win.webContents.ipc.handlers.get("capsule:ready")?.();

    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();

    expect(win.webContents.ipc.once).toHaveBeenCalledWith("capsule:snippet-response", expect.any(Function));
    expect(win.webContents.send).toHaveBeenCalledWith("capsule:show-snippet", { trigger: "email" });
    const listenerOrder = win.webContents.ipc.once.mock.invocationCallOrder[0];
    const sendOrder = win.webContents.send.mock.invocationCallOrder[0];
    expect(listenerOrder).toBeDefined();
    expect(sendOrder).toBeDefined();
    expect(listenerOrder as number).toBeLessThan(sendOrder as number);

    win.webContents.ipc.handlers.get("capsule:snippet-response")?.({}, { accepted: true });
    expect(onResponse).toHaveBeenCalledWith(true);
  });
});
