export const STOP_TAIL_GRACE_MS = 300;
// First quiet check for the renderer stream. A word still being said after release needs this long to show up as loud.
export const RENDERER_TAIL_GRACE_MS = 300;
export const STOP_QUIET_MS = 120;
// Auto gain lifts room noise at the end of a clip, so the tail rarely reads as quiet. The cap bounds the wait.
export const STOP_MAX_WAIT_MS = 450;
export const STOP_POLL_MS = 40;

// A continuous renderer stream cannot become callback-quiet like the native queue.
// Frames below the room's noise level count as quiet. The level stays between these bounds.
// Auto gain lifts room noise as a recording goes on (0.007-0.011 RMS at the end in Vaani Dev traces),
// so the level comes from the whole recording, not its opening.
export const STOP_QUIET_RMS = 0.002;
export const STOP_QUIET_MAX_RMS = 0.02;

// Quiet level for the stop tail: 1.5x the quietest fifth of the recording's frames, within the bounds.
// The low multiplier keeps a soft final word above the level. With no pauses to measure, the fixed minimum applies.
export function quietThresholdFromNoise(frameRms: readonly number[]): number {
  // Digital silence (RMS 0) counts as the quietest room, so a device that opens with zeros keeps the low level.
  const sorted = frameRms.filter((rms) => Number.isFinite(rms) && rms >= 0).sort((a, b) => a - b);
  const floor = sorted[Math.floor((sorted.length - 1) * 0.2)] ?? 0;
  const median = sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0;
  // A quiet fifth that is not well below the median is speech or steady noise, not a room floor.
  if (floor > median * 0.5) return STOP_QUIET_RMS;
  return Math.min(STOP_QUIET_MAX_RMS, Math.max(STOP_QUIET_RMS, floor * 1.5));
}

export function shouldFinishRendererDrain(elapsedMs: number, quietForMs: number): boolean {
  return elapsedMs >= STOP_MAX_WAIT_MS || (elapsedMs >= RENDERER_TAIL_GRACE_MS && quietForMs >= STOP_QUIET_MS);
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
    setTimeout(poll, RENDERER_TAIL_GRACE_MS);
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
