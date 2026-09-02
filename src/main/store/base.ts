import { readFile, writeFile, mkdir, rename, unlink, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
  let data: T;
  try {
    data = JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
  await chmod(filePath, 0o600).catch(() => undefined);
  return data;
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
