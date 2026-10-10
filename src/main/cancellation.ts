export interface CancellationScope {
  signal: AbortSignal;
  dispose: () => void;
}

export function createCancellationScope(parentSignal?: AbortSignal, deadlineAt?: number): CancellationScope {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onParentAbort = () => controller.abort(parentSignal?.reason);

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  if (!controller.signal.aborted && deadlineAt !== undefined) {
    const remainingMs = Math.max(0, deadlineAt - Date.now());
    if (remainingMs === 0) controller.abort("deadline");
    else timer = setTimeout(() => controller.abort("deadline"), remainingMs);
  }

  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

export function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

export function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  return new Promise((resolve, reject) => {
    let onAbort: () => void;
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
