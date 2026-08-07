import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { UNRESOLVED_BUILD_GIT_SHA } from "./src/shared/buildIdentifier";

export function resolveBuildGitSha(cwd = resolve(__dirname)): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) return UNRESOLVED_BUILD_GIT_SHA;

    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return status.trim() ? `${sha}-dirty` : sha;
  } catch {
    return UNRESOLVED_BUILD_GIT_SHA;
  }
}

const buildGitSha = resolveBuildGitSha();

export default defineConfig({
  define: {
    __VAANI_BUILD_GIT_SHA__: JSON.stringify(buildGitSha)
  },
  resolve: {
    alias: {
      "@shared": resolve("src/shared"),
      "@main": resolve("src/main")
    }
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: { entryFileNames: "main.js" }
    }
  }
});
