import { afterEach, describe, expect, it, vi } from "vitest";
import { pollRecoveryReadiness } from "@renderer/hooks/useHistory";

afterEach(() => vi.useRealTimers());

describe("recovery readiness polling", () => {
  it("reloads while initializing and stops when readiness changes", async () => {
    vi.useFakeTimers();
    const reload = vi.fn(async () => {});
    const stop = pollRecoveryReadiness(reload);
    await vi.advanceTimersByTimeAsync(1100);
    expect(reload).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
