export const STOP_TAIL_GRACE_MS = 300;
export const STOP_QUIET_MS = 120;
export const STOP_MAX_WAIT_MS = 1200;
export const STOP_POLL_MS = 40;

// A continuous renderer stream cannot become callback-quiet like the native queue.
// Frames below this fixed level count as quiet. A soft ending above it still counts as speech.
export const STOP_QUIET_RMS = 0.002;

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
