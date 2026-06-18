import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory clipboard model shared by the child_process + electron mocks.
let fakeClipboard = "";
const writes: { value: string; t: number }[] = [];

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: unknown, res: { stdout: string; stderr: string }) => void;
    const cmd = args[0] as string;
    if (cmd === "pbpaste") {
      cb(null, { stdout: fakeClipboard, stderr: "" });
    } else {
      cb(null, { stdout: "", stderr: "" });
    }
  },
  execFileSync: (cmd: string, _args: unknown, opts?: { input?: string }) => {
    if (cmd === "pbcopy") {
      const input = opts?.input ?? "";
      fakeClipboard = input;
      writes.push({ value: input, t: Date.now() });
    }
    return "";
  },
}));

vi.mock("electron", () => ({
  clipboard: {
    readText: () => fakeClipboard,
    writeText: (value: string) => {
      fakeClipboard = value;
      writes.push({ value, t: Date.now() });
    },
  },
}));

vi.mock("@main/nativeBridge", () => ({
  nativeBridge: {
    pasteText: () => true,
    typeText: () => true,
    getFocusedSelection: undefined,
  },
}));

vi.mock("@main/injection/target", () => ({
  activateTargetApp: () => Promise.resolve(true),
  isTargetFrontmost: () => true,
}));

vi.mock("@main/injection/policy", () => ({
  isClipboardOnlyTarget: (t?: { appName?: string }) => /chrome|terminal/i.test(t?.appName ?? ""),
  shouldPreferTypingInjection: () => false,
}));

const chromeTarget = { appBundleId: "com.google.Chrome", appName: "Google Chrome" } as const;
const RESTORE_DELAY_MS = 1_200;

describe("ClipboardTextInjector restore timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeClipboard = "";
    writes.length = 0;
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
    await vi.runAllTimersAsync();

    expect(fakeClipboard).toBe("userCopied");
  });

  it("ignores an older injection's pending restore (generation guard)", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const injector = new ClipboardTextInjector();

    // First injection: original differs, so a restore is scheduled.
    fakeClipboard = "orig1";
    const first = injector.inject("same", chromeTarget);
    await vi.advanceTimersByTimeAsync(1_500);
    await first;
    expect(fakeClipboard).toBe("same");

    // Second injection sees "same" as its original; identical text means it
    // schedules no restore of its own. The first injection's restore is still
    // pending and would clobber the clipboard with "orig1" without the guard.
    const second = injector.inject("same", chromeTarget);
    await vi.runAllTimersAsync();
    await second;

    expect(fakeClipboard).toBe("same");
  });

  it("returns success for a clipboard-only target", async () => {
    const { ClipboardTextInjector } = await import("@main/injection/clipboard");
    const injector = new ClipboardTextInjector();

    fakeClipboard = "original";
    const promise = injector.inject("dictated", chromeTarget);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ success: true, method: "clipboard" });
  });
});
