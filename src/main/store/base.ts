import { readFile, writeFile, mkdir, rename, unlink, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    const data = JSON.parse(raw) as T;
    await chmod(filePath, 0o600).catch(() => undefined);
    return data;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o700);
  const tmp = join(dir, `.tmp-${randomBytes(6).toString("hex")}`);
  await writeFile(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  await chmod(filePath, 0o600);
}
