import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionTimers } from "@main/dictation/sessionTimers";

describe("SessionTimers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replaces an existing timeout with the same name", () => {
    const timers = new SessionTimers();
    const first = vi.fn();
    const second = vi.fn();

    timers.setTimeout("reset", first, 100);
    timers.setTimeout("reset", second, 100);
    vi.advanceTimersByTime(100);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(timers.has("reset")).toBe(true);
  });

  it("clears selected timers", () => {
    const timers = new SessionTimers();
    const reset = vi.fn();
    const stale = vi.fn();

    timers.setTimeout("reset", reset, 100);
    timers.setTimeout("staleSession", stale, 100);
    timers.clearAll(["reset"]);
    vi.advanceTimersByTime(100);

    expect(reset).not.toHaveBeenCalled();
    expect(stale).toHaveBeenCalledTimes(1);
  });

  it("clears intervals through clearAll", () => {
    const timers = new SessionTimers();
    const tick = vi.fn();

    timers.setInterval("editWatch", tick, 100);
    vi.advanceTimersByTime(250);
    timers.clearAll();
    vi.advanceTimersByTime(250);

    expect(tick).toHaveBeenCalledTimes(2);
    expect(timers.has("editWatch")).toBe(false);
  });
});
