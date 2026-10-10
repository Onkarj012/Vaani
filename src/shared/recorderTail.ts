export const STOP_TAIL_GRACE_MS = 300;
export const STOP_QUIET_MS = 120;
export const STOP_MAX_WAIT_MS = 1200;
export const STOP_POLL_MS = 40;

// A continuous renderer stream cannot become callback-quiet like the native queue.
// Frames below the room's noise level count as quiet. The level stays between these bounds.
export const STOP_QUIET_RMS = 0.002;
export const STOP_QUIET_MAX_RMS = 0.01;
// How much of the recording's opening is used to measure room noise.
export const NOISE_SAMPLE_MS = 500;

// Quiet level for the stop tail, from the opening frames' RMS. Speech at the press only raises it up to the cap.
export function quietThresholdFromNoise(openingFrameRms: readonly number[]): number {
  const sorted = openingFrameRms.filter((rms) => Number.isFinite(rms) && rms > 0).sort((a, b) => a - b);
  const floor = sorted[Math.floor((sorted.length - 1) * 0.2)] ?? 0;
  return Math.min(STOP_QUIET_MAX_RMS, Math.max(STOP_QUIET_RMS, floor * 2));
}

export function shouldFinishRendererDrain(elapsedMs: number, quietForMs: number): boolean {
  return elapsedMs >= STOP_MAX_WAIT_MS || (elapsedMs >= STOP_TAIL_GRACE_MS && quietForMs >= STOP_QUIET_MS);
}

// Waits for the tail after stop, ending once audio has been quiet long enough or the cap is reached.
export async function waitForRendererDrain(stopRequestedAt: number, getLastLoudFrameAt: () => number, isActive: () => boolean): Promise<void> {
  await new Promise<void>((resolve) => {
    const poll = (): void => {
      const elapsed = Date.now() - stopRequestedAt;
      if (!isActive() || shouldFinishRendererDrain(elapsed, Date.now() - getLastLoudFrameAt())) {
        resolve();
      } else {
        setTimeout(poll, Math.min(STOP_POLL_MS, STOP_MAX_WAIT_MS - elapsed));
      }
    };
    setTimeout(poll, STOP_TAIL_GRACE_MS);
  });
}

export function trailingRms(samples: Float32Array, sampleRate: number): number {
  const count = Math.min(samples.length, Math.floor(sampleRate * 0.3));
  if (count === 0) return 0;
  let sumSquares = 0;
  for (let index = samples.length - count; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / count);
}
