import { afterEach, describe, expect, it, vi } from "vitest";
import { RENDERER_TAIL_GRACE_MS, STOP_MAX_WAIT_MS, STOP_QUIET_MAX_RMS, STOP_QUIET_RMS, quietThresholdFromNoise, trailingRms, waitForRendererDrain } from "@shared/recorderTail";

afterEach(() => vi.useRealTimers());

describe("renderer stop drain", () => {
  it("finishes after the 300 ms grace when audio was already quiet for 120 ms", async () => {
    vi.useFakeTimers();
    let finished = false;
    const drain = waitForRendererDrain(Date.now(), () => Date.now() - 200, () => true).then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(RENDERER_TAIL_GRACE_MS - 1);
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

  it("sets the quiet level from the recording's room noise, between 0.002 and 0.02", () => {
    // Room noise measured in Vaani Dev traces sat at 0.005 to 0.011 by the end of a clip, so a fixed 0.002 always ran to the cap.
    expect(quietThresholdFromNoise([...new Array(6).fill(0.004), ...new Array(14).fill(0.05)])).toBeCloseTo(0.006);
    expect(quietThresholdFromNoise([...new Array(5).fill(0.03), ...new Array(15).fill(0.2)])).toBe(STOP_QUIET_MAX_RMS);
    expect(quietThresholdFromNoise(new Array(20).fill(0.0001))).toBe(STOP_QUIET_RMS);
    expect(quietThresholdFromNoise([])).toBe(STOP_QUIET_RMS);
  });

  it("uses the fixed minimum when no quiet frames stand apart from the speech", () => {
    // Thirty frames at 0.05 have no room floor, so a soft ending at 0.004 must not count as quiet.
    expect(quietThresholdFromNoise(new Array(30).fill(0.05))).toBe(STOP_QUIET_RMS);
  });

  it("ends the tail at room noise that auto gain lifted to 0.011 during a dictation with pauses", () => {
    const speechWithPauses = [...new Array(40).fill(0.05), ...new Array(15).fill(0.008)];
    expect(quietThresholdFromNoise(speechWithPauses)).toBeGreaterThan(0.011);
    // A soft final word at twice the room noise stays loud.
    expect(quietThresholdFromNoise(speechWithPauses)).toBeLessThan(0.016);
  });

  it("counts digital silence at the start as the quietest room, not as missing data", () => {
    const openingZerosThenSpeech = [...new Array(10).fill(0), ...new Array(10).fill(0.02)];
    expect(quietThresholdFromNoise(openingZerosThenSpeech)).toBe(STOP_QUIET_RMS);
  });

  it("finishes early when the tail settles to room noise", async () => {
    vi.useFakeTimers();
    const threshold = quietThresholdFromNoise([...new Array(6).fill(0.004), ...new Array(14).fill(0.05)]);
    const roomNoiseRms = 0.005;
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

  it("keeps draining while a soft ending stays above the level computed for a recording with no quiet frames", async () => {
    vi.useFakeTimers();
    const threshold = quietThresholdFromNoise(new Array(30).fill(0.05));
    // The final word is soft (0.004) and runs to 400 ms after stop, so the tail must not end at the 300 ms grace.
    const softEndingRms = 0.004;
    const softEndingMs = 400;
    const startedAt = Date.now();
    let lastLoudAt = startedAt;
    let finishedAt = 0;
    const drain = waitForRendererDrain(startedAt, () => lastLoudAt, () => true).then(() => { finishedAt = Date.now(); });
    for (let elapsed = 0; elapsed < STOP_MAX_WAIT_MS && !finishedAt; elapsed += 10) {
      await vi.advanceTimersByTimeAsync(10);
      if (elapsed < softEndingMs && softEndingRms >= threshold) lastLoudAt = Date.now();
    }
    await drain;
    expect(finishedAt - startedAt).toBe(STOP_MAX_WAIT_MS);
  });
});
