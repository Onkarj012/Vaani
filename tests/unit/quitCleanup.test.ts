import { describe, expect, it, vi } from "vitest";
import { createQuitHandler } from "@main/quitCleanup";

describe("createQuitHandler", () => {
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
    await Promise.resolve();
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
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
