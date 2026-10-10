import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBuildGitSha } from "../../vite.main.config";

let tempDir: string | null = null;

async function createGitCheckout(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "vaani-build-id-test-"));
  execFileSync("git", ["init", "-q"], { cwd: tempDir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
  execFileSync("git", ["config", "user.name", "Vaani Tests"], { cwd: tempDir });
  await writeFile(join(tempDir, "tracked.txt"), "clean\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: tempDir });
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: tempDir });
  return tempDir;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("build identifier", () => {
  it("returns the short commit SHA for a clean Git checkout", async () => {
    const checkout = await createGitCheckout();

    expect(resolveBuildGitSha(checkout)).toMatch(/^[0-9a-f]{7}$/i);
  });

  it("marks a Git checkout dirty when tracked content changes", async () => {
    const checkout = await createGitCheckout();
    await writeFile(join(checkout, "tracked.txt"), "dirty\n");

    expect(resolveBuildGitSha(checkout)).toMatch(/^[0-9a-f]{7}-dirty$/i);
  });

  it("uses an explicit fallback when the build directory is not a Git checkout", () => {
    expect(resolveBuildGitSha("/definitely-not-a-git-checkout")).toBe("unresolved");
  });
});
