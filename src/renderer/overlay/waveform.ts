export const BAR_MAX_HEIGHT = 22
export const BAR_MIN_HEIGHT = 3
export const BAR_GAIN = 18
// Asymmetric envelope: snap up to loud transients fast, decay slowly — this
// is what makes a level meter read as "alive" instead of jittery.
export const ENVELOPE_ATTACK = 0.6
export const ENVELOPE_RELEASE = 0.15
const SNAP_EPSILON = 0.002

export function barScale(v: number): number {
  return Math.max(BAR_MIN_HEIGHT, Math.min(BAR_MAX_HEIGHT, v * BAR_GAIN)) / BAR_MAX_HEIGHT
}

// One envelope-follower step toward `target`, starting from `current`.
// Snaps to the target once within SNAP_EPSILON so the value settles exactly
// instead of asymptotically approaching it forever.
export function envelopeStep(current: number, target: number): number {
  const rate = target > current ? ENVELOPE_ATTACK : ENVELOPE_RELEASE
  const next = current + (target - current) * rate
  return Math.abs(next - target) < SNAP_EPSILON ? target : next
}
