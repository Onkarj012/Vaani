export interface QuitCleanupEvent {
  preventDefault(): void;
}

export interface QuitCleanupDependencies {
  flush: () => Promise<void>;
  cleanup: () => void | Promise<void>;
  quit: () => void;
  flushTimeoutMs?: number;
}

export function createQuitHandler(deps: QuitCleanupDependencies): (event: QuitCleanupEvent) => void {
  let cleanupStarted = false;
  return (event) => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    event.preventDefault();
    void (async () => {
      try {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            deps.flush(),
            new Promise<void>((resolve) => { timeout = setTimeout(resolve, deps.flushTimeoutMs ?? 3_000); }),
          ]);
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      } finally {
        try {
          await deps.cleanup();
        } finally {
          deps.quit();
        }
      }
    })().catch(() => undefined);
  };
}
