// Ribbon waveform from the approved overlay design: 13 bars in a 69 x 22 px lane, level ripples out from the center.
export const RIBBON_WIDTH = 69;
export const RIBBON_HEIGHT = 22;
const BAR_COUNT = 13;
const MID = 6;
const BAR_WIDTH = 3;
const BAR_GAP = 2.5;
const HISTORY_HZ = 30;
const HISTORY_SIZE = 64;

export interface RibbonBar { x: number; width: number; height: number; alpha: number }

// Smooths the incoming level (fast attack, slower release) and keeps a short history the outer bars lag behind.
export class LevelHistory {
  level = 0;
  private readonly samples = new Float32Array(HISTORY_SIZE);
  private head = 0;
  private carry = 0;

  // Advances by `dt` seconds toward `target` (0-1).
  step(target: number, dt: number): void {
    const tau = target > this.level ? 0.035 : 0.14;
    this.level += (target - this.level) * (1 - Math.exp(-dt / tau));
    this.carry += dt;
    while (this.carry >= 1 / HISTORY_HZ) {
      this.carry -= 1 / HISTORY_HZ;
      this.head = (this.head + 1) % HISTORY_SIZE;
      this.samples[this.head] = this.level;
    }
  }

  // Level `lag` history frames ago, interpolated.
  at(lag: number): number {
    const whole = Math.floor(lag);
    const a = this.samples[(this.head - whole + HISTORY_SIZE * 2) % HISTORY_SIZE] ?? 0;
    const b = this.samples[(this.head - whole - 1 + HISTORY_SIZE * 2) % HISTORY_SIZE] ?? 0;
    return a + (b - a) * (lag - whole);
  }
}

// Bar geometry for one frame. `at(lag)` gives the level `lag` frames ago; `t` is seconds, for a slight shimmer.
export function ribbonBars(at: (lag: number) => number, t: number, height = RIBBON_HEIGHT, width = RIBBON_WIDTH): RibbonBar[] {
  const x0 = (width - (BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP)) / 2;
  const bars: RibbonBar[] = [];
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const d = Math.abs(i - MID);
    const v = clamp(at(d * 1.2) * (1 - 0.42 * Math.pow(d / MID, 1.3)) * (0.92 + 0.08 * Math.sin(t * 7 + i)));
    const lv = Math.pow(v, 0.75);
    bars.push({
      x: x0 + i * (BAR_WIDTH + BAR_GAP),
      width: BAR_WIDTH,
      height: 3 + lv * (height - 3),
      alpha: (0.55 + 0.45 * (1 - d / MID)) * (0.55 + 0.45 * lv),
    });
  }
  return bars;
}

// Text color that reads on the accent fill (Send button, primary action).
export function accentInk(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return "#ffffff";
  const n = parseInt(match[1], 16);
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return luminance > 0.4 ? "#14141a" : "#ffffff";
}

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}
