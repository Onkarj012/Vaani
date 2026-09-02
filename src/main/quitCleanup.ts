export interface QuitCleanupEvent {
  preventDefault(): void;
}

export interface QuitCleanupDependencies {
  flush: () => Promise<void>;
  cleanup: () => void | Promise<void>;
  quit: () => void;
}

export function createQuitHandler(deps: QuitCleanupDependencies): (event: QuitCleanupEvent) => void {
  let cleanupStarted = false;
  return (event) => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    event.preventDefault();
    void (async () => {
      try {
        await deps.flush();
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
