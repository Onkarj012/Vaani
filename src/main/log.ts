const isDev = !__filename.includes(".asar");

export function debug(category: string, message: string, ...args: unknown[]): void {
  if (!isDev) return;
  console.log(`[vaani:${category}] ${message}`, ...args);
}

export function warn(category: string, message: string, ...args: unknown[]): void {
  if (!isDev) return;
  console.warn(`[vaani:${category}] ${message}`, ...args);
}

export function error(category: string, message: string, ...args: unknown[]): void {
  console.error(`[vaani:${category}] ${message}`, ...args);
}
