import { readFile, writeFile, mkdir, rename, unlink, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { error } from "@main/log";

// Thrown when a store file exists but cannot be read, parsed, or validated.
export class JsonFileReadError extends Error {
  constructor(filePath: string, reason: string) {
    super(`Could not read ${filePath} (${reason}). The file was left unchanged.`);
    this.name = "JsonFileReadError";
  }
}

// Returns the fallback only when the file is missing. Any other failure throws, so the caller never overwrites the file.
export async function readJsonFile<T>(filePath: string, fallback: T, isValid: (data: unknown) => boolean): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return fallback;
    throw failRead(filePath, err);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw failRead(filePath, err);
  }
  if (!isValid(data)) throw failRead(filePath, "unexpected JSON shape");
  await chmod(filePath, 0o600).catch(() => undefined);
  return data as T;
}

// Logs a failed read and returns the error to throw.
function failRead(filePath: string, reason: unknown): JsonFileReadError {
  const message = reason instanceof Error ? reason.message : String(reason);
  error("store", `Could not read ${filePath}: ${message}`);
  return new JsonFileReadError(filePath, message);
}

export async function repairJsonFilePermissions(filePath: string): Promise<void> {
  await chmod(dirname(filePath), 0o700).catch(() => undefined);
  await chmod(filePath, 0o600).catch(() => undefined);
}

export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o700);
  const tmp = join(dir, `.tmp-${randomBytes(6).toString("hex")}`);
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  // Rename is the commit point. A permission-hardening failure after it must
  // not make callers retry a write that is already durable.
  await chmod(filePath, 0o600).catch(() => undefined);
}
