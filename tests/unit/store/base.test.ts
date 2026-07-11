import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { writeJsonFile } from "@main/store/base";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("JSON file store helpers", () => {
  it("writes owner-only files and directories", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "vaani-base-test-"));
    const filePath = join(tempDir, "nested", "data.json");

    await writeJsonFile(filePath, { text: "private" });

    expect((await stat(join(tempDir, "nested"))).mode & 0o777).toBe(0o700);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({ text: "private" });
  });
});
