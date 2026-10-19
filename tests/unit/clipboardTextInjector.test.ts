import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PLAIN_TEXT = "public.utf8-plain-text";
type Entry = { type: string; data: Buffer };
type Item = Entry[];

// In-memory pasteboard shared by the electron, native, and child_process mocks.
let pasteboard: Item[] = [];
let pasteboardChangeCount = 0;
let failAppleScriptAction = false;
let holdAppleScriptPaste = false;
let releaseAppleScriptPaste: (() => void) | null = null;
let hangAppleScript = false;
let refuseClipboardWrite = false;
let clearThenFailOnce = false;
const helperTimeouts: number[] = [];
const writes: { value: string; t: number }[] = [];

function textItems(value: string): Item[] {
  return value ? [[{ type: PLAIN_TEXT, data: Buffer.from(value, "utf8") }]] : [];
}

function cloneItems(items: Item[]): Item[] {
  return items.map((item) => item.map((entry) => ({ type: entry.type, data: Buffer.from(entry.data) })));
}

function clipboardText(): string {
  const entry = pasteboard.flat().find((candidate) => candidate.type === PLAIN_TEXT);
  return entry ? entry.data.toString("utf8") : "";
}

function setClipboardText(value: string): void {
  pasteboard = textItems(value);
}

function storeItems(items: Item[]): void {
  pasteboard = cloneItems(items);
  pasteboardChangeCount += 1;
  writes.push({ value: clipboardText(), t: Date.now() });
}

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const cmd = args[0] as string;
    const cb = args[args.length - 1] as (err: unknown, res: { stdout: string; stderr: string }) => void;
    const options = (args.length > 3 ? args[2] : undefined) as { timeout?: number } | undefined;
    if (cmd === "osascript") {
      helperTimeouts.push(options?.timeout ?? 0);
      if (hangAppleScript) {
        if (options?.timeout) setTimeout(() => cb(new Error("killed after timeout"), { stdout: "", stderr: "" }), options.timeout);
        return undefined;
      }
    }
    if (cmd === "osascript" && holdAppleScriptPaste && args.some((arg) => Array.isArray(arg) && arg.some((part) => typeof part === "string" && part.includes("key code 9")))) {
      releaseAppleScriptPaste = () => cb(null, { stdout: "", stderr: "" });
    } else if (cmd === "osascript" && failAppleScriptAction) {
      cb(new Error("osascript failed after dispatch"), { stdout: "", stderr: "" });
    } else {
      cb(null, { stdout: "", stderr: "" });
    }
    return undefined;
  },
}));

vi.mock("electron", () => ({
  clipboard: {
    readText: () => clipboardText(),
    writeText: (value: string) => {
      if (refuseClipboardWrite) return;
      storeItems(textItems(value));
    },
  },
}));

const bridge = vi.hoisted(() => ({
  pasteText: vi.fn((_text: string, _expectedChangeCount: number) => true),
  typeText: vi.fn((_text: string) => true),
  getFocusedSelection: undefined as undefined | (() => { location: number; length: number }),
  getFocusedElementIdentity: vi.fn<() => string | null>(() => null),
  getFocusedValue: vi.fn<() => string | null>(() => null),
  setFocusedSelection: vi.fn((_location: number, _length: number) => true),
  getClipboardChangeCount: () => pasteboardChangeCount,
  readPasteboard: (maxBytes: number) => {
    const total = pasteboard.flat().reduce((sum, entry) => sum + entry.data.length, 0);
    return total > maxBytes ? null : cloneItems(pasteboard);
  },
  writePasteboard: (items: Item[]) => {
    // Clears the pasteboard, then fails, like NSPasteboard.writeObjects returning NO after clearContents.
    if (clearThenFailOnce) {
      clearThenFailOnce = false;
      storeItems([]);
      return { failedChangeCount: pasteboardChangeCount };
    }
    // A refused write reports a new change count without storing anything, like a helper that lies.
    if (refuseClipboardWrite) {
      pasteboardChangeCount += 1;
      return pasteboardChangeCount;
    }
    storeItems(items);
    return pasteboardChangeCount;
  },
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
    setClipboardText("");
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
    clearThenFailOnce = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not restore the original clipboard before the restore delay", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const injector = new ClipboardTextInjector();

    setClipboardText("original");
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
    expect(clipboardText()).toBe("original");
  });

  it("does not overwrite a clipboard the user changed before restore fires", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const injector = new ClipboardTextInjector();

    setClipboardText("original");
    const done = injector.inject("dictated", chromeTarget);
    // Let inject() finish its paste path but not the pending restore.
    await vi.advanceTimersByTimeAsync(1_500);
    await done;
    expect(clipboardText()).toBe("dictated");

    // User copies something else during the restore window.
    setClipboardText("userCopied");
    pasteboardChangeCount += 1;
    await vi.runAllTimersAsync();

    expect(clipboardText()).toBe("userCopied");
  });

  it("restores the user's clipboard, not an earlier injection's text, across overlapping injections", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const injector = new ClipboardTextInjector();

    // First injection: original differs, so a restore is scheduled.
    setClipboardText("orig1");
    const first = injector.inject("same", chromeTarget);
    await vi.advanceTimersByTimeAsync(1_500);
    await first;
    expect(clipboardText()).toBe("same");

    // The second injection starts while the first restore is pending. The
    // first restore must not fire mid-paste, and the eventual restore must
    // return the user's own clipboard rather than the first dictation.
    const second = injector.inject("same", chromeTarget);
    await vi.runAllTimersAsync();
    await second;

    expect(clipboardText()).toBe("orig1");
    expect(writes.filter((w) => w.value === "orig1")).toHaveLength(1);
  });

  it("returns success for a clipboard-only target", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const injector = new ClipboardTextInjector();

    setClipboardText("original");
    const promise = injector.inject("dictated", chromeTarget);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ success: true, method: "clipboard" });
  });

  it("serializes two simultaneous injections and restores the original clipboard", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    setClipboardText("my original copy");
    const injector = new ClipboardTextInjector();
    const first = injector.inject("first dictation", chromeTarget);
    const second = injector.inject("second dictation", chromeTarget);
    await vi.runAllTimersAsync();
    await expect(first).resolves.toMatchObject({ success: true });
    await expect(second).resolves.toMatchObject({ success: true });
    expect(clipboardText()).toBe("my original copy");
    expect(writes.filter((write) => write.value === "my original copy")).toHaveLength(1);
  });

  it("keeps an explicit copy made after insertion when the delayed restore fires", async () => {
    const { ClipboardTextInjector, cancelPendingClipboardRestore } = await import("@main/injection/clipboard");
    const injector = new ClipboardTextInjector();

    setClipboardText("original");
    const done = injector.inject("dictated", chromeTarget);
    await vi.advanceTimersByTimeAsync(1_500);
    await done;
    cancelPendingClipboardRestore();
    setClipboardText("dictated");
    await vi.runAllTimersAsync();

    expect(clipboardText()).toBe("dictated");
  });

  it("keeps a user copy of identical dictated text after insertion", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    setClipboardText("original");
    const done = new ClipboardTextInjector().inject("dictated", chromeTarget);
    await vi.advanceTimersByTimeAsync(1_500);
    await done;

    setClipboardText("dictated");
    pasteboardChangeCount += 1;
    await vi.runAllTimersAsync();

    expect(clipboardText()).toBe("dictated");
    expect(writes.filter((write) => write.value === "original")).toHaveLength(0);
  });
});

describe("ClipboardTextInjector dispatch safety", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setClipboardText("original");
    pasteboardChangeCount = 0;
    writes.length = 0;
    focus.frontmost = true;
    bridge.pasteText.mockReset().mockReturnValue(true);
    bridge.typeText.mockReset().mockReturnValue(true);
    bridge.getFocusedSelection = undefined;
    bridge.getFocusedElementIdentity.mockReset().mockReturnValue(null);
    bridge.getFocusedValue.mockReset().mockReturnValue(null);
    bridge.setFocusedSelection.mockClear();
    failAppleScriptAction = false;
    holdAppleScriptPaste = false;
    releaseAppleScriptPaste = null;
    refuseClipboardWrite = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves the delayed caret only while the original field and guard remain valid", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const { createInjectionGuard } = await import("@main/injection/guard");
    for (const scenario of ["same-field", "other-field", "cancelled", "unknown-field"] as const) {
      const controller = new AbortController();
      bridge.getFocusedSelection = () => ({ location: 0, length: 0 });
      bridge.getFocusedValue.mockReturnValue("dictated");
      bridge.getFocusedElementIdentity.mockReturnValue(scenario === "unknown-field" ? null : "field-a");
      bridge.setFocusedSelection.mockClear();

      const promise = new ClipboardTextInjector().inject("dictated", chromeTarget, createInjectionGuard({ signal: controller.signal }));
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(promise).resolves.toEqual({ success: true, method: "clipboard" });
      expect(bridge.setFocusedSelection).not.toHaveBeenCalled();

      if (scenario === "other-field") bridge.getFocusedElementIdentity.mockReturnValue("field-b");
      if (scenario === "cancelled") controller.abort();
      await vi.advanceTimersByTimeAsync(300);

      if (scenario === "same-field") {
        expect(bridge.setFocusedSelection).toHaveBeenCalledExactlyOnceWith(8, 0);
      } else {
        expect(bridge.setFocusedSelection).not.toHaveBeenCalled();
      }
      await vi.runAllTimersAsync();
    }
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

  it("refuses to paste when the pasteboard write does not store the text", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    refuseClipboardWrite = true;
    const attempt = new ClipboardTextInjector().inject("dictated", chromeTarget);
    await vi.runAllTimersAsync();
    await expect(attempt)
      .resolves.toEqual({ success: false, reason: "insertion_failed" });
    expect(clipboardText()).toBe("original");
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
    expect(clipboardText()).toBe("original");
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

  it("returns as soon as the paste is confirmed, without a fixed post-paste wait", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    let elapsed = 0;
    let dispatchedAt: number | null = null;
    bridge.pasteText.mockImplementation(() => { dispatchedAt = elapsed; return true; });
    let settled = false;
    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget).finally(() => { settled = true; });
    while (!settled && elapsed < 3_000) { await vi.advanceTimersByTimeAsync(10); elapsed += 10; }

    await expect(promise).resolves.toEqual({ success: true, method: "clipboard" });
    expect(dispatchedAt).not.toBeNull();
    // The old code slept 600 ms here after an already confirmed paste.
    expect(elapsed - (dispatchedAt ?? 0)).toBeLessThanOrEqual(20);
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
    setClipboardText("dictated");
    pasteboardChangeCount += 1;
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "cancelled" });
    expect(bridge.pasteText).not.toHaveBeenCalled();
    expect(clipboardText()).toBe("dictated");
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
    expect(clipboardText()).toBe("original");
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
    setClipboardText("original");
    let settledAt = 0;
    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget, createInjectionGuard({ isTargetValid: () => valid }))
      .then((result) => { settledAt = Date.now(); return result; });
    await vi.advanceTimersByTimeAsync(300);
    expect(clipboardText()).toBe("dictated");
    valid = false;
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: false, reason: "target_changed" });
    expect(clipboardText()).toBe("original");
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

describe("ClipboardTextInjector pasteboard snapshot and helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setClipboardText("original");
    pasteboardChangeCount = 0;
    writes.length = 0;
    helperTimeouts.length = 0;
    focus.frontmost = true;
    bridge.pasteText.mockReset().mockReturnValue(true);
    bridge.typeText.mockReset().mockReturnValue(true);
    bridge.getFocusedSelection = undefined;
    failAppleScriptAction = false;
    holdAppleScriptPaste = false;
    hangAppleScript = false;
    refuseClipboardWrite = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts the user's items back when a failed write already cleared the clipboard", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const original: Item[] = [[{ type: "public.png", data: Buffer.from([137, 80, 78, 71]) }, { type: PLAIN_TEXT, data: Buffer.from("original") }]];
    pasteboard = cloneItems(original);
    clearThenFailOnce = true;

    const attempt = new ClipboardTextInjector().inject("dictated", chromeTarget);
    await vi.runAllTimersAsync();

    await expect(attempt).resolves.toEqual({ success: false, reason: "insertion_failed" });
    expect(pasteboard).toEqual(original);
    expect(bridge.pasteText).not.toHaveBeenCalled();
  });

  it("keeps a new user copy made while verifying the dictated text", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const { clipboard } = await import("electron");
    const read = vi.spyOn(clipboard, "readText").mockImplementationOnce(() => {
      storeItems(textItems("userCopy"));
      return clipboardText();
    });

    try {
      const attempt = new ClipboardTextInjector().inject("dictated", chromeTarget);
      await vi.runAllTimersAsync();

      await expect(attempt).resolves.toEqual({ success: false, reason: "insertion_failed" });
      expect(clipboardText()).toBe("userCopy");
      expect(writes.filter((write) => write.value === "original")).toHaveLength(0);
      expect(bridge.pasteText).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it("restores every pasteboard format and item, not only plain text", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const original: Item[] = [
      [
        { type: "public.png", data: Buffer.from([137, 80, 78, 71]) },
        { type: "public.rtf", data: Buffer.from("{\\rtf1 hi}") },
        { type: PLAIN_TEXT, data: Buffer.from("original") },
      ],
      [{ type: "public.file-url", data: Buffer.from("file:///tmp/a.txt") }],
    ];
    pasteboard = cloneItems(original);

    const promise = new ClipboardTextInjector().inject("dictated", chromeTarget);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: true, method: "clipboard" });
    expect(pasteboard).toEqual(original);
  });

  it("keeps a copy the user makes during the activation wait instead of restoring an older one", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const promise = new ClipboardTextInjector().inject("dictated", textEditTarget);
    await vi.advanceTimersByTimeAsync(100);
    setClipboardText("userCopy");
    pasteboardChangeCount += 1;
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: true, method: "clipboard" });
    expect(clipboardText()).toBe("userCopy");
    expect(writes.filter((write) => write.value === "original")).toHaveLength(0);
  });

  it("keeps only plain text when the pasteboard is over the size cap", async () => {
    const { ClipboardTextInjector, PASTEBOARD_SNAPSHOT_MAX_BYTES } = await import("@main/injection/clipboard");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    pasteboard = [
      [{ type: "public.png", data: Buffer.alloc(PASTEBOARD_SNAPSHOT_MAX_BYTES + 1) }],
      [{ type: PLAIN_TEXT, data: Buffer.from("original") }],
    ];

    const promise = new ClipboardTextInjector().inject("dictated", chromeTarget);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: true, method: "clipboard" });
    expect(pasteboard).toEqual([[{ type: PLAIN_TEXT, data: Buffer.from("original") }]]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("finishes when AppleScript hangs, with every helper call under a timeout", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    hangAppleScript = true;

    const promise = new ClipboardTextInjector().inject("dictated", chromeTarget);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ success: true, method: "clipboard" });
    // Native paste releases modifiers itself, so this path may run no helper at all.
    expect(helperTimeouts.every((timeout) => timeout > 0)).toBe(true);
    expect(clipboardText()).toBe("original");
  });
});
