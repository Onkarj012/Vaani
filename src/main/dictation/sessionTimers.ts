export type SessionTimerName =
  | "reset"
  | "finalization"
  | "audioFrame"
  | "recorderStart"
  | "staleSession"
  | "uptimeLog"
  | "editWatch"
  | "editWatchTimeout"
  | "editPrompt";

type TimerHandle = ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;

export class SessionTimers {
  private readonly handles = new Map<SessionTimerName, TimerHandle>();

  setTimeout(name: SessionTimerName, callback: () => void, timeoutMs: number): void {
    this.clear(name);
    this.handles.set(name, setTimeout(callback, timeoutMs));
  }

  setInterval(name: SessionTimerName, callback: () => void, intervalMs: number): void {
    this.clear(name);
    this.handles.set(name, setInterval(callback, intervalMs));
  }

  clear(name: SessionTimerName): void {
    const handle = this.handles.get(name);
    if (!handle) return;
    clearTimeout(handle);
    this.handles.delete(name);
  }

  clearAll(names?: SessionTimerName[]): void {
    const keys = names ?? Array.from(this.handles.keys());
    for (const name of keys) {
      this.clear(name);
    }
  }

  has(name: SessionTimerName): boolean {
    return this.handles.has(name);
  }
}
