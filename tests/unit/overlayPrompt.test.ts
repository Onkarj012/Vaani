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
  hide = vi.fn();
  showInactive = vi.fn();
  focus = vi.fn();
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
    // Listener registration must precede the specific send that reveals the
    // prompt UI — not necessarily every send, since an unrelated state
    // snapshot may legitimately go out to the renderer first (e.g. on ready).
    const listenerOrder = win.webContents.ipc.once.mock.invocationCallOrder[0];
    const showSnippetCallIndex = win.webContents.send.mock.calls.findIndex(
      (args) => args[0] === "capsule:show-snippet"
    );
    const sendOrder = win.webContents.send.mock.invocationCallOrder[showSnippetCallIndex];
    expect(listenerOrder).toBeDefined();
    expect(sendOrder).toBeDefined();
    expect(listenerOrder as number).toBeLessThan(sendOrder as number);

    win.webContents.ipc.handlers.get("capsule:snippet-response")?.({}, { accepted: true });
    expect(onResponse).toHaveBeenCalledWith(true);
  });

  it("dismisses a dictionary prompt when the toast times out", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    const onResponse = vi.fn();

    controller.showDictionaryPrompt("Bani", "Vaani", onResponse);
    await Promise.resolve();
    await Promise.resolve();

    const win = windows[0];
    if (!win) throw new Error("Expected overlay window to be created.");
    win.webContents.ipc.handlers.get("capsule:ready")?.();

    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();

    expect(win.webContents.ipc.once).toHaveBeenCalledWith("capsule:dictionary-response", expect.any(Function));
    expect(win.showInactive).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith("capsule:show-dictionary", { word: "Bani", correction: "Vaani" });

    await vi.advanceTimersByTimeAsync(8_000);

    expect(onResponse).toHaveBeenCalledWith(false);
  });

  it("shows an existing hidden overlay window for dictionary prompts", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    const onResponse = vi.fn();

    controller.prewarm();
    await Promise.resolve();
    await Promise.resolve();

    const win = windows[0];
    if (!win) throw new Error("Expected overlay window to be created.");
    win.webContents.ipc.handlers.get("capsule:ready")?.();
    win.showInactive.mockClear();
    win.focus.mockClear();

    controller.showDictionaryPrompt("WriteX", "WriteTex", onResponse);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();

    expect(win.showInactive).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith("capsule:show-dictionary", { word: "WriteX", correction: "WriteTex" });
  });

  it("clears a wedged prompt state after a renderer crash so hide() can commit again", async () => {
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

    // Renderer dies mid-prompt, before it ever responds.
    const goneHandler = win.webContents.on.mock.calls.find(
      ([channel]) => channel === "render-process-gone"
    )?.[1] as (() => void) | undefined;
    expect(goneHandler).toBeDefined();
    goneHandler?.();

    // The pending prompt promise must resolve (declined) rather than hang forever.
    expect(onResponse).toHaveBeenCalledWith(false);

    // A stale promptActive flag would make hide() a permanent no-op — verify
    // the recovered window actually commits a hide.
    const newWin = windows[1];
    if (!newWin) throw new Error("Expected a recovered overlay window.");
    controller.hide();
    vi.advanceTimersByTime(300);
    expect(newWin.hide).toHaveBeenCalled();
  });
});
