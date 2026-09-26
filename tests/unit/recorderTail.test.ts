import { afterEach, describe, expect, it, vi } from "vitest";
import { trailingRms, waitForRendererDrain } from "@shared/recorderTail";

afterEach(() => vi.useRealTimers());

describe("renderer stop drain", () => {
  it("finishes after grace when audio has been quiet for 120 ms", async () => {
    vi.useFakeTimers();
    let finished = false;
    const drain = waitForRendererDrain(Date.now(), () => Date.now() - 200, () => true).then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(299);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await drain;
    expect(finished).toBe(true);
  });

  it("waits for quiet after grace but never exceeds the 1200 ms cap", async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    let lastLoudAt = startedAt;
    const quietDrain = waitForRendererDrain(startedAt, () => lastLoudAt, () => true);
    await vi.advanceTimersByTimeAsync(280);
    lastLoudAt = Date.now();
    await vi.advanceTimersByTimeAsync(140);
    await quietDrain;
    expect(Date.now() - startedAt).toBe(420);

    const cappedAt = Date.now();
    const cappedDrain = waitForRendererDrain(cappedAt, () => Date.now(), () => true);
    await vi.advanceTimersByTimeAsync(1199);
    let done = false;
    void cappedDrain.then(() => { done = true; });
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await cappedDrain;
    expect(done).toBe(true);
  });

  it("measures the final 300 ms from unnormalized samples", () => {
    expect(trailingRms(new Float32Array([...new Array(700).fill(0.1), ...new Array(300).fill(0.02)]), 1000)).toBeCloseTo(0.02);
  });
});
