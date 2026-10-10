import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory clipboard model shared by the child_process + electron mocks.
let fakeClipboard = "";
let pasteboardChangeCount = 0;
let failAppleScriptAction = false;
let holdAppleScriptPaste = false;
let releaseAppleScriptPaste: (() => void) | null = null;
let refuseClipboardWrite = false;
const writes: { value: string; t: number }[] = [];

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: unknown, res: { stdout: string; stderr: string }) => void;
    const cmd = args[0] as string;
    if (cmd === "pbpaste") {
      cb(null, { stdout: fakeClipboard, stderr: "" });
    } else if (cmd === "osascript" && holdAppleScriptPaste && args.some((arg) => Array.isArray(arg) && arg.some((part) => typeof part === "string" && part.includes("key code 9")))) {
      releaseAppleScriptPaste = () => cb(null, { stdout: "", stderr: "" });
    } else if (cmd === "osascript" && failAppleScriptAction) {
      cb(new Error("osascript failed after dispatch"), { stdout: "", stderr: "" });
    } else {
      cb(null, { stdout: "", stderr: "" });
    }
  },
  execFileSync: (cmd: string, _args: unknown, opts?: { input?: string }) => {
    if (cmd === "pbcopy") {
      if (refuseClipboardWrite) return "";
      const input = opts?.input ?? "";
      fakeClipboard = input;
      pasteboardChangeCount += 1;
      writes.push({ value: input, t: Date.now() });
    }
    return "";
  },
}));

vi.mock("electron", () => ({
  clipboard: {
    readText: () => fakeClipboard,
    writeText: (value: string) => {
      if (refuseClipboardWrite) return;
      fakeClipboard = value;
      pasteboardChangeCount += 1;
      writes.push({ value, t: Date.now() });
    },
  },
}));

const bridge = vi.hoisted(() => ({
  pasteText: vi.fn((_text: string, _expectedChangeCount: number) => true),
  typeText: vi.fn((_text: string) => true),
  getFocusedSelection: undefined as undefined | (() => { location: number; length: number }),
  getClipboardChangeCount: () => pasteboardChangeCount,
}));
const focus = vi.hoisted(() => ({ frontmost: true }));

vi.mock("@main/nativeBridge", () => ({ nativeBridge: bridge }));

vi.mock("@main/injection/target", () => ({
  activateTargetApp: () => Promise.resolve(true),
  isTargetFrontmost: () => focus.frontmost,
}));

vi.mock("@main/injection/policy", () => ({
  isClipboardOnlyTarget: (t?: { appName?: string }) => /chrome|terminal/i.test(t?.appName ?? ""),
  shouldPreferTypingInjection: () => false,
}));

const chromeTarget = { appBundleId: "com.google.Chrome", appName: "Google Chrome" } as const;
const textEditTarget = { appBundleId: "com.apple.TextEdit", appName: "TextEdit", selection: { location: 0, length: 0 } };
const RESTORE_DELAY_MS = 1_200;

describe("ClipboardTextInjector restore timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeClipboard = "";
    pasteboardChangeCount = 0;
    writes.length = 0;
    focus.frontmost = true;
    bridge.pasteText.mockReset().mockReturnValue(true);
    bridge.typeText.mockReset().mockReturnValue(true);
    bridge.getFocusedSelection = undefined;
    failAppleScriptAction = false;
    holdAppleScriptPaste = false;
    releaseAppleScriptPaste = null;
    refuseClipboardWrite = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not restore the original clipboard before the restore delay", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const injector = new ClipboardTextInjector();

    fakeClipboard = "original";
    let resolveTime = 0;
    const done = injector.inject("dictated", chromeTarget).then(() => {
      resolveTime = Date.now();
    });

    await vi.runAllTimersAsync();
    await done;

    const restoreWrite = [...writes].reverse().find((w) => w.value === "original");
    expect(restoreWrite).toBeTruthy();
    // Restore must wait the full delay measured from when inject() resolved,
    // not the old sub-second window that let a stale clipboard win the paste race.
    expect(restoreWrite!.t - resolveTime).toBeGreaterThanOrEqual(RESTORE_DELAY_MS - 50);
    expect(fakeClipboard).toBe("original");
  });

  it("does not overwrite a clipboard the user changed before restore fires", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const injector = new ClipboardTextInjector();

    fakeClipboard = "original";
    const done = injector.inject("dictated", chromeTarget);
    // Let inject() finish its paste path but not the pending restore.
    await vi.advanceTimersByTimeAsync(1_500);
    await done;
    expect(fakeClipboard).toBe("dictated");

    // User copies something else during the restore window.
    fakeClipboard = "userCopied";
    pasteboardChangeCount += 1;
    await vi.runAllTimersAsync();

    expect(fakeClipboard).toBe("userCopied");
  });

  it("restores the user's clipboard, not an earlier injection's text, across overlapping injections", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const injector = new ClipboardTextInjector();

    // First injection: original differs, so a restore is scheduled.
    fakeClipboard = "orig1";
    const first = injector.inject("same", chromeTarget);
    await vi.advanceTimersByTimeAsync(1_500);
    await first;
    expect(fakeClipboard).toBe("same");

    // The second injection starts while the first restore is pending. The
    // first restore must not fire mid-paste, and the eventual restore must
    // return the user's own clipboard rather than the first dictation.
    const second = injector.inject("same", chromeTarget);
    await vi.runAllTimersAsync();
    await second;

    expect(fakeClipboard).toBe("orig1");
    expect(writes.filter((w) => w.value === "orig1")).toHaveLength(1);
  });

  it("returns success for a clipboard-only target", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const injector = new ClipboardTextInjector();

    fakeClipboard = "original";
    const promise = injector.inject("dictated", chromeTarget);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ success: true, method: "clipboard" });
  });

  it("serializes two simultaneous injections and restores the original clipboard", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    fakeClipboard = "my original copy";
    const injector = new ClipboardTextInjector();
    const first = injector.inject("first dictation", chromeTarget);
    const second = injector.inject("second dictation", chromeTarget);
    await vi.runAllTimersAsync();
    await expect(first).resolves.toMatchObject({ success: true });
    await expect(second).resolves.toMatchObject({ success: true });
    expect(fakeClipboard).toBe("my original copy");
    expect(writes.filter((write) => write.value === "my original copy")).toHaveLength(1);
  });

  it("keeps an explicit copy made after insertion when the delayed restore fires", async () => {
    const { ClipboardTextInjector, cancelPendingClipboardRestore } = await import("@main/injection/clipboard");
    const injector = new ClipboardTextInjector();

    fakeClipboard = "original";
    const done = injector.inject("dictated", chromeTarget);
    await vi.advanceTimersByTimeAsync(1_500);
    await done;
    cancelPendingClipboardRestore();
    fakeClipboard = "dictated";
    await vi.runAllTimersAsync();

    expect(fakeClipboard).toBe("dictated");
  });

  it("keeps a user copy of identical dictated text after insertion", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    fakeClipboard = "original";
    const done = new ClipboardTextInjector().inject("dictated", chromeTarget);
    await vi.advanceTimersByTimeAsync(1_500);
    await done;

    fakeClipboard = "dictated";
    pasteboardChangeCount += 1;
    await vi.runAllTimersAsync();

    expect(fakeClipboard).toBe("dictated");
    expect(writes.filter((write) => write.value === "original")).toHaveLength(0);
  });
});

describe("ClipboardTextInjector dispatch safety", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeClipboard = "original";
    pasteboardChangeCount = 0;
    writes.length = 0;
    focus.frontmost = true;
    bridge.pasteText.mockReset().mockReturnValue(true);
    bridge.typeText.mockReset().mockReturnValue(true);
    bridge.getFocusedSelection = undefined;
    failAppleScriptAction = false;
    holdAppleScriptPaste = false;
    releaseAppleScriptPaste = null;
    refuseClipboardWrite = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not touch the clipboard when already cancelled", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const { createInjectionGuard } = await import("@main/injection/guard");
    const controller = new AbortController();
    controller.abort("user-cancelled");

    const result = await new ClipboardTextInjector().inject("dictated", textEditTarget, createInjectionGuard({ signal: controller.signal }));

    expect(result).toEqual({ success: false, reason: "cancelled" });
    expect(writes).toHaveLength(0);
    expect(bridge.pasteText).not.toHaveBeenCalled();
  });

  it("does not touch the clipboard when pasteboard ownership cannot be checked", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const originalCounter = bridge.getClipboardChangeCount;
    bridge.getClipboardChangeCount = () => { throw new Error("unavailable"); };
    try {
      await expect(new ClipboardTextInjector().inject("dictated", chromeTarget))
        .resolves.toEqual({ success: false, reason: "insertion_failed" });
      expect(writes).toHaveLength(0);
      expect(bridge.pasteText).not.toHaveBeenCalled();
    } finally {
      bridge.getClipboardChangeCount = originalCounter;
    }
  });

  it("refuses to paste when pbcopy reports success without storing the text", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    refuseClipboardWrite = true;
    const attempt = new ClipboardTextInjector().inject("dictated", chromeTarget);
    await vi.runAllTimersAsync();
    await expect(attempt)
      .resolves.toEqual({ success: false, reason: "insertion_failed" });
    expect(fakeClipboard).toBe("original");
    expect(bridge.pasteText).not.toHaveBeenCalled();
  });

  it("stops before dispatch when cancelled during the settle wait and restores the clipboard", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const { createInjectionGuard } = await import("@main/injection/guard");
    const controller = new AbortController();

    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget, createInjectionGuard({ signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(300);
    controller.abort("user-cancelled");
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "cancelled" });
    expect(bridge.pasteText).not.toHaveBeenCalled();
    expect(bridge.typeText).not.toHaveBeenCalled();
    expect(fakeClipboard).toBe("original");
  });

  it("stops before dispatch when cancelled during target activation", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const { createInjectionGuard } = await import("@main/injection/guard");
    const controller = new AbortController();
    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget, createInjectionGuard({ signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(400);
    controller.abort("user-cancelled");
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "cancelled" });
    expect(bridge.pasteText).not.toHaveBeenCalled();
  });

  it("reports uncertainty when cancelled during the post-dispatch wait", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const { createInjectionGuard } = await import("@main/injection/guard");
    const controller = new AbortController();
    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget, createInjectionGuard({ signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(bridge.pasteText).toHaveBeenCalledTimes(1);
    controller.abort("user-cancelled");
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "outcome_uncertain" });
    expect(bridge.pasteText).toHaveBeenCalledTimes(1);
  });

  it("stops before dispatch when the focused target changes during the wait", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const { createInjectionGuard } = await import("@main/injection/guard");
    let valid = true;

    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget, createInjectionGuard({ isTargetValid: () => valid }));
    await vi.advanceTimersByTimeAsync(300);
    valid = false;
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "target_changed" });
    expect(bridge.pasteText).not.toHaveBeenCalled();
  });

  it("does not paste or restore after the user copies the same text during the settle wait", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget);
    await vi.advanceTimersByTimeAsync(300);
    fakeClipboard = "dictated";
    pasteboardChangeCount += 1;
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "cancelled" });
    expect(bridge.pasteText).not.toHaveBeenCalled();
    expect(fakeClipboard).toBe("dictated");
  });

  it("reports an uncertain outcome instead of trying another method after a dispatched paste loses focus", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    bridge.getFocusedSelection = () => ({ location: 0, length: 0 });
    bridge.pasteText.mockImplementation(() => {
      focus.frontmost = false;
      return true;
    });

    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "outcome_uncertain" });
    expect(bridge.pasteText).toHaveBeenCalledTimes(1);
    expect(bridge.typeText).not.toHaveBeenCalled();
  });

  it("reports an uncertain outcome when cancelled after the paste was dispatched", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const { createInjectionGuard } = await import("@main/injection/guard");
    const controller = new AbortController();
    bridge.getFocusedSelection = () => ({ location: 0, length: 0 });
    bridge.pasteText.mockImplementation(() => {
      controller.abort("user-cancelled");
      return true;
    });

    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget, createInjectionGuard({ signal: controller.signal }));
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "outcome_uncertain" });
    expect(bridge.pasteText).toHaveBeenCalledTimes(1);
    expect(bridge.typeText).not.toHaveBeenCalled();
  });

  it("uses native paste for Unicode text even when AppleScript is unavailable", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    failAppleScriptAction = true;

    const promise = new ClipboardTextInjector().inject("héllo", textEditTarget);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: true, method: "clipboard" });
    expect(bridge.pasteText).toHaveBeenCalledOnce();
    expect(bridge.typeText).not.toHaveBeenCalled();
  });

  it("never launches a delayed AppleScript paste for clipboard-only apps", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    holdAppleScriptPaste = true;
    const promise = new ClipboardTextInjector().inject("dictated", chromeTarget);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(releaseAppleScriptPaste).toBeNull();
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: true, method: "clipboard" });
    expect(bridge.pasteText).toHaveBeenCalledOnce();
  });

  it("native paste uses the owned clipboard without writing it again", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: true, method: "clipboard" });
    expect(bridge.pasteText).toHaveBeenCalledWith("dictated", expect.any(Number), "com.apple.TextEdit", undefined);
    expect(writes.filter((write) => write.value === "dictated")).toHaveLength(1);
    expect(fakeClipboard).toBe("original");
  });

  it("does not try AppleScript after native paste reports failure following dispatch", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    bridge.pasteText.mockReturnValue(false);

    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "outcome_uncertain" });
    expect(bridge.pasteText).toHaveBeenCalledTimes(1);
    expect(bridge.typeText).not.toHaveBeenCalled();
  });

  it("reports an uncertain clipboard-only paste when cancelled immediately after dispatch", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const { createInjectionGuard } = await import("@main/injection/guard");
    const controller = new AbortController();
    const promise = new ClipboardTextInjector().inject("dictated", chromeTarget, createInjectionGuard({ signal: controller.signal }), () => controller.abort());
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "outcome_uncertain" });
    expect(bridge.pasteText).toHaveBeenCalledOnce();
  });

  it("stops before dispatch when focus changes to another app during activation", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const { createInjectionGuard } = await import("@main/injection/guard");
    let currentApp = "com.apple.TextEdit";
    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget, createInjectionGuard({ isTargetValid: () => currentApp === textEditTarget.appBundleId }));
    await vi.advanceTimersByTimeAsync(300);
    currentApp = "com.openai.chatgpt";
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "target_changed" });
    expect(bridge.pasteText).not.toHaveBeenCalled();
  });

  it("checks target again before writing dictated text to the clipboard", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const { createInjectionGuard } = await import("@main/injection/guard");
    let valid = true;
    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget, createInjectionGuard({ isTargetValid: () => valid }));
    await vi.advanceTimersByTimeAsync(100);
    valid = false;
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "target_changed" });
    expect(writes).toHaveLength(0);
    expect(bridge.pasteText).not.toHaveBeenCalled();
  });

  it("restores the owned clipboard immediately when target changes before dispatch", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const { createInjectionGuard } = await import("@main/injection/guard");
    let valid = true;
    fakeClipboard = "original";
    let settledAt = 0;
    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget, createInjectionGuard({ isTargetValid: () => valid }))
      .then((result) => { settledAt = Date.now(); return result; });
    await vi.advanceTimersByTimeAsync(300);
    expect(fakeClipboard).toBe("dictated");
    valid = false;
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "target_changed" });
    expect(fakeClipboard).toBe("original");
    expect(writes.find((write) => write.value === "original")?.t).toBeLessThanOrEqual(settledAt);
    expect(bridge.pasteText).not.toHaveBeenCalled();
  });

  it("stops before dispatch when focus moves to another field in the same app", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const { createInjectionGuard } = await import("@main/injection/guard");
    let focusedField = "first";
    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget, createInjectionGuard({ isTargetValid: () => focusedField === "first" }));
    await vi.advanceTimersByTimeAsync(300);
    focusedField = "second";
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "target_changed" });
    expect(bridge.pasteText).not.toHaveBeenCalled();
  });
});
