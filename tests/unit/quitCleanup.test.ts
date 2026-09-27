import { describe, expect, it, vi } from "vitest";
import { createQuitHandler } from "@main/quitCleanup";

describe("createQuitHandler", () => {
  it("quits after the flush deadline when a flush never settles", async () => {
    vi.useFakeTimers();
    try {
      const cleanup = vi.fn();
      const quit = vi.fn();
      const handler = createQuitHandler({
        flush: () => new Promise<void>(() => undefined), cleanup, quit, flushTimeoutMs: 25,
      });
      handler({ preventDefault: vi.fn() });
      await vi.advanceTimersByTimeAsync(25);
      expect(cleanup).toHaveBeenCalledOnce();
      expect(quit).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("prevents recursive quit until flush and cleanup finish", async () => {
    let releaseFlush: (() => void) | null = null;
    const flush = vi.fn(() => new Promise<void>((resolve) => { releaseFlush = resolve; }));
    const cleanup = vi.fn();
    const quit = vi.fn();
    const preventDefault = vi.fn();
    const handler = createQuitHandler({ flush, cleanup, quit });

    handler({ preventDefault });
    handler({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();

    releaseFlush!();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("still cleans up and exits when the flush reports a failure", async () => {
    const cleanup = vi.fn();
    const quit = vi.fn();
    const handler = createQuitHandler({
      flush: vi.fn(async () => { throw new Error("flush failed"); }),
      cleanup,
      quit,
    });

    handler({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
