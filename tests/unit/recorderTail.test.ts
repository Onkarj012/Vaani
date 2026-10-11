import { afterEach, describe, expect, it, vi } from "vitest";
import { STOP_MAX_WAIT_MS, STOP_QUIET_MAX_RMS, STOP_QUIET_RMS, quietThresholdFromNoise, trailingRms, waitForRendererDrain } from "@shared/recorderTail";

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

  it("waits for quiet after grace but never exceeds the cap", async () => {
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
    await vi.advanceTimersByTimeAsync(STOP_MAX_WAIT_MS - 1);
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

  it("sets the quiet level from the room noise at the start, between 0.002 and 0.01", () => {
    // Room noise measured in Vaani Dev traces sat at 0.005 to 0.011, so a fixed 0.002 always ran to the cap.
    expect(quietThresholdFromNoise(new Array(20).fill(0.004))).toBeCloseTo(0.008);
    expect(quietThresholdFromNoise(new Array(20).fill(0.0001))).toBe(STOP_QUIET_RMS);
    expect(quietThresholdFromNoise(new Array(20).fill(0.05))).toBe(STOP_QUIET_MAX_RMS);
    expect(quietThresholdFromNoise([])).toBe(STOP_QUIET_RMS);
  });

  it("counts digital silence at the start as the quietest room, not as missing data", () => {
    const openingZerosThenSpeech = [...new Array(10).fill(0), ...new Array(10).fill(0.02)];
    expect(quietThresholdFromNoise(openingZerosThenSpeech)).toBe(STOP_QUIET_RMS);
  });

  it("finishes early when the tail settles to room noise", async () => {
    vi.useFakeTimers();
    const threshold = quietThresholdFromNoise(new Array(20).fill(0.004));
    const roomNoiseRms = 0.006;
    const startedAt = Date.now();
    let lastLoudAt = startedAt;
    let finishedAt = 0;
    const drain = waitForRendererDrain(startedAt, () => lastLoudAt, () => true).then(() => { finishedAt = Date.now(); });
    for (let elapsed = 0; elapsed < STOP_MAX_WAIT_MS && !finishedAt; elapsed += 40) {
      await vi.advanceTimersByTimeAsync(40);
      if (roomNoiseRms >= threshold) lastLoudAt = Date.now();
    }
    await drain;
    expect(finishedAt - startedAt).toBeLessThan(STOP_MAX_WAIT_MS);
  });

  it("keeps draining while a soft ending stays above the fixed level", async () => {
    vi.useFakeTimers();
    const softEndingRms = 0.004;
    const startedAt = Date.now();
    let lastLoudAt = startedAt;
    let finishedAt = 0;
    const drain = waitForRendererDrain(startedAt, () => lastLoudAt, () => true).then(() => { finishedAt = Date.now(); });
    for (let elapsed = 0; elapsed < STOP_MAX_WAIT_MS && !finishedAt; elapsed += 10) {
      await vi.advanceTimersByTimeAsync(10);
      if (softEndingRms >= STOP_QUIET_RMS) lastLoudAt = Date.now();
    }
    await drain;
    expect(finishedAt - startedAt).toBe(STOP_MAX_WAIT_MS);
  });
});
