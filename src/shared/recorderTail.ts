export const STOP_TAIL_GRACE_MS = 300;
export const STOP_QUIET_MS = 120;
export const STOP_MAX_WAIT_MS = 1200;
export const STOP_POLL_MS = 40;

// A continuous renderer stream cannot become callback-quiet like the native queue.
// Treat frames below this acoustic level as quiet instead.
export const STOP_QUIET_RMS = 0.002;
const QUIET_FLOOR_CAP_RMS = 0.01;

export function rendererQuietThreshold(frameRms: readonly number[]): number {
  const sorted = frameRms.filter((rms) => Number.isFinite(rms) && rms > 0.00001 && rms < 0.01).sort((a, b) => a - b);
  if (sorted.length === 0) return STOP_QUIET_RMS;
  const floor = sorted[Math.floor((sorted.length - 1) * 0.2)] ?? 0;
  // Capped so a quiet (whispered) clip's own speech never counts as silence.
  return Math.min(QUIET_FLOOR_CAP_RMS, Math.max(STOP_QUIET_RMS, floor * 1.8));
}

export function shouldFinishRendererDrain(elapsedMs: number, quietForMs: number): boolean {
  return elapsedMs >= STOP_MAX_WAIT_MS || (elapsedMs >= STOP_TAIL_GRACE_MS && quietForMs >= STOP_QUIET_MS);
}

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
