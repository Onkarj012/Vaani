// One-shot timer that can pause and resume, keeping the time left. Used for the prompt countdown.
export class PausableTimer {
  private handle: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  private remaining: number;
  private done = false;

  constructor(private readonly onFire: () => void, durationMs: number) {
    this.remaining = durationMs;
    this.resume();
  }

  // Stops the clock and keeps the time left.
  pause(): void {
    if (!this.handle) return;
    clearTimeout(this.handle);
    this.handle = null;
    this.remaining = Math.max(0, this.remaining - (Date.now() - this.startedAt));
  }

  // Restarts the clock with the time left.
  resume(): void {
    if (this.handle || this.done) return;
    this.startedAt = Date.now();
    this.handle = setTimeout(() => {
      this.handle = null;
      this.done = true;
      this.onFire();
    }, this.remaining);
  }

  // Stops for good; the callback never runs.
  cancel(): void {
    this.done = true;
    if (this.handle) clearTimeout(this.handle);
    this.handle = null;
  }

  remainingMs(): number {
    return this.handle ? Math.max(0, this.remaining - (Date.now() - this.startedAt)) : this.remaining;
  }
}
