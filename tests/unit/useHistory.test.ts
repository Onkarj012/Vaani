import { afterEach, describe, expect, it, vi } from "vitest";
import { loadHistoryData, pollRecoveryReadiness, runRecoveryMutation } from "@renderer/hooks/useHistory";

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

describe("History reload", () => {
  it("ignores an older response and leaves loading controlled by the latest reload", async () => {
    let resolveOld: (value: []) => void = () => undefined;
    const old = new Promise<[]>((resolve) => { resolveOld = resolve; });
    const api = {
      getHistory: vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce([]),
      getRecoveryReadiness: vi.fn(async () => ({ state: "ready" as const, entryCount: 0 })),
      getRecoveryEntries: vi.fn(async () => []),
    };
    const update = { loading: vi.fn(), entries: vi.fn(), readiness: vi.fn(), recoveryEntries: vi.fn() };
    const state = { generation: 0 };
    const first = loadHistoryData(state, api, update);
    const second = loadHistoryData(state, api, update);
    await second;
    resolveOld([]);
    await first;
    expect(update.entries).toHaveBeenCalledTimes(1);
    expect(update.loading.mock.calls.map(([value]) => value)).toEqual([true, true, false]);
  });

  it("preserves both lists after IPC errors", async () => {
    const api = {
      getHistory: vi.fn(async () => { throw new Error("history unavailable"); }),
      getRecoveryReadiness: vi.fn(async () => ({ state: "ready" as const, entryCount: 1 })),
      getRecoveryEntries: vi.fn(async () => { throw new Error("recovery unavailable"); }),
    };
    const update = { loading: vi.fn(), entries: vi.fn(), readiness: vi.fn(), recoveryEntries: vi.fn() };
    await loadHistoryData({ generation: 0 }, api, update);
    expect(update.entries).not.toHaveBeenCalled();
    expect(update.recoveryEntries).not.toHaveBeenCalled();
    expect(update.readiness).toHaveBeenCalledWith({ state: "degraded", entryCount: null });
  });

  it("surfaces a false recovery mutation without reloading", async () => {
    const reload = vi.fn(async () => {});
    await expect(runRecoveryMutation(async () => false, reload)).rejects.toThrow("could not be completed");
    expect(reload).not.toHaveBeenCalled();
    await runRecoveryMutation(async () => true, reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
