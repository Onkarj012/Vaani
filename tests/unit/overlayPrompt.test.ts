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
      invokers: new Map<string, (...args: unknown[]) => unknown>(),
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        this.webContents.ipc.invokers.set(channel, handler);
      }),
    },
    events: new Map<string, Handler>(),
    on: vi.fn((event: string, handler: Handler) => {
      this.webContents.events.set(event, handler);
    }),
    send: vi.fn(),
    isCrashed: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    getURL: vi.fn(() => "test://overlay"),
    forcefullyCrashRenderer: vi.fn(),
    setWindowOpenHandler: vi.fn(),
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
  setVisibleOnAllWorkspaces(): void {}
  setAlwaysOnTop(): void {}
  setIgnoreMouseEvents(): void {}
  setFocusable(): void {}
  setBounds = vi.fn<(bounds: { width: number; height: number }) => void>();
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
    // Earlier controllers' watchdogs keep rebuilding mock windows that never report visible.
    vi.clearAllTimers();
    vi.stubGlobal("OVERLAY_WINDOW_VITE_NAME", "overlay_window");
    windows.length = 0;
  });

  // Creates the window, marks the renderer ready, and lets the prompt reach the renderer.
  async function openWindow(start: () => void): Promise<BrowserWindowMock> {
    start();
    await Promise.resolve();
    await Promise.resolve();
    const win = windows[0];
    if (!win) throw new Error("Expected overlay window to be created.");
    win.webContents.ipc.handlers.get("capsule:ready")?.();
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    return win;
  }

  function reply(win: BrowserWindowMock, value: unknown): unknown {
    const handler = win.webContents.ipc.invokers.get("capsule:prompt-reply");
    if (!handler) throw new Error("Expected prompt reply handler.");
    return handler({}, value);
  }

  function lastPrompt(win: BrowserWindowMock): { id: number } & Record<string, unknown> {
    const call = win.webContents.send.mock.calls.filter(([channel]) => channel === "capsule:show-prompt").at(-1);
    if (!call) throw new Error("Expected a prompt to be shown.");
    return call[1] as { id: number } & Record<string, unknown>;
  }

  it("sends the snippet phrase and returns edited values", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    const onResponse = vi.fn();
    const win = await openWindow(() => controller.showSnippetPrompt("email", "me@example.com", onResponse));

    expect(win.webContents.ipc.handle).toHaveBeenCalledWith("capsule:prompt-reply", expect.any(Function));
    const prompt = lastPrompt(win);
    expect(prompt).toMatchObject({ kind: "snippet", trigger: "email", text: "me@example.com", durationMs: 8_000 });

    expect(reply(win, { id: prompt.id, accepted: true, first: " /mail ", second: "me@example.com " })).toEqual({ ok: true });
    expect(onResponse).toHaveBeenCalledWith({ trigger: "mail", text: "me@example.com" });
  });

  it("keeps the prompt open and returns the error when an edit is refused", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    const onResponse = vi.fn();
    const win = await openWindow(() => controller.showSnippetPrompt("reply", "Thanks!", onResponse, () => ["sig"]));
    const { id } = lastPrompt(win);

    expect(reply(win, { id, accepted: true, first: "SIG", second: "Thanks!" })).toEqual({ ok: false, error: "/SIG is already a snippet." });
    expect(onResponse).not.toHaveBeenCalled();
    expect(reply(win, { id, accepted: true, first: "thanks", second: "Thanks!" })).toEqual({ ok: true });
    expect(onResponse).toHaveBeenCalledWith({ trigger: "thanks", text: "Thanks!" });
  });

  it("rejects malformed and stale replies", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    const onResponse = vi.fn();
    const win = await openWindow(() => controller.showDictionaryPrompt("Bani", "Vaani", onResponse));
    const { id } = lastPrompt(win);

    expect(reply(win, { id: id + 1, accepted: false })).toMatchObject({ ok: false });
    expect(reply(win, { id, accepted: true, first: 1, second: "Vaani" })).toMatchObject({ ok: false });
    expect(reply(win, { id, accepted: true, first: "Bani", second: "Vaani", extra: true })).toMatchObject({ ok: false });
    expect(onResponse).not.toHaveBeenCalled();
  });

  it("dismisses a dictionary prompt when the 8 s countdown runs out", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    const onResponse = vi.fn();
    const win = await openWindow(() => controller.showDictionaryPrompt("Bani", "Vaani", onResponse));

    expect(win.showInactive).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(lastPrompt(win)).toMatchObject({ kind: "dictionary", spoken: "Bani", written: "Vaani" });

    await vi.advanceTimersByTimeAsync(8_000);
    expect(onResponse).toHaveBeenCalledWith(null);
  });

  it("pauses the countdown while the card is held and resumes with the time left", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    const onResponse = vi.fn();
    const win = await openWindow(() => controller.showDictionaryPrompt("Bani", "Vaani", onResponse));
    const hold = win.webContents.ipc.handlers.get("capsule:prompt-hold");
    if (!hold) throw new Error("Expected prompt hold listener.");

    await vi.advanceTimersByTimeAsync(5_000);
    hold({}, true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onResponse).not.toHaveBeenCalled();

    // About 3 s were left at the pause (the window setup above can use up to 50 ms of it).
    hold({}, false);
    await vi.advanceTimersByTimeAsync(2_900);
    expect(onResponse).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(onResponse).toHaveBeenCalledWith(null);
  });

  it("keeps the prompt window up for the Saved confirmation, and the next prompt waits for it", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    const first = vi.fn();
    const win = await openWindow(() => controller.showDictionaryPrompt("Bani", "Vaani", first));
    const { id } = lastPrompt(win);

    expect(reply(win, { id, accepted: true, first: "Bani", second: "Vaani" })).toEqual({ ok: true });
    expect(first).toHaveBeenCalledWith({ spoken: "Bani", written: "Vaani" });

    const second = vi.fn();
    controller.showDictionaryPrompt("get hub", "GitHub", second);
    await vi.advanceTimersByTimeAsync(1_600);
    expect(win.webContents.send).not.toHaveBeenCalledWith("capsule:hide-expanded");
    expect(lastPrompt(win).id).toBe(id);
    expect(win.setBounds.mock.calls.at(-1)?.[0]).toMatchObject({ width: 384, height: 320 });

    await vi.advanceTimersByTimeAsync(200);
    expect(win.webContents.send).toHaveBeenCalledWith("capsule:hide-expanded");
    expect(lastPrompt(win)).toMatchObject({ spoken: "get hub", written: "GitHub" });
    expect(second).not.toHaveBeenCalled();
  });

  it("a new dictation dismisses an open prompt", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    const onResponse = vi.fn();
    const win = await openWindow(() => controller.showSnippetPrompt("email", "me@example.com", onResponse));

    controller.setPressed();
    expect(onResponse).toHaveBeenCalledWith(null);
    expect(reply(win, { id: lastPrompt(win).id, accepted: true, first: "email", second: "me@example.com" })).toMatchObject({ ok: false });
    expect(onResponse).toHaveBeenCalledTimes(1);
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
    expect(lastPrompt(win)).toMatchObject({ kind: "dictionary", spoken: "WriteX", written: "WriteTex" });
  });

  it("dismisses a held prompt when the renderer crashes and the window is rebuilt", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    const onResponse = vi.fn();
    const win = await openWindow(() => controller.showDictionaryPrompt("Bani", "Vaani", onResponse));
    win.webContents.ipc.handlers.get("capsule:prompt-hold")?.({}, true);

    win.webContents.events.get("render-process-gone")?.({}, { reason: "crashed" });
    expect(onResponse).toHaveBeenCalledWith(null);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onResponse).toHaveBeenCalledTimes(1);
    // The rebuilt mock window never reports ready, so stop its recovery loop before the next test.
    controller.destroy();
  });

  it("does not bring a window back for a prompt queued behind Saved when the overlay is destroyed", async () => {
    const { OverlayController } = await import("@main/overlay");
    const controller = new OverlayController();
    const win = await openWindow(() => controller.showDictionaryPrompt("Bani", "Vaani", vi.fn()));
    reply(win, { id: lastPrompt(win).id, accepted: true, first: "Bani", second: "Vaani" });
    const queued = vi.fn();
    controller.showDictionaryPrompt("get hub", "GitHub", queued);
    await Promise.resolve();

    controller.destroy();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(queued).toHaveBeenCalledWith(null);
    expect(windows).toHaveLength(1);
  });
});
