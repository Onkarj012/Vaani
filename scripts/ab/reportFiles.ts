import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface ReportPaths {
  markdown: string;
  json: string;
}

// Creates each report pair without replacing an earlier run, even when timestamps collide.
export function writeCleanupReport(dir: string, stamp: string, markdown: string, json: string): ReportPaths {
  for (let suffix = 0; ; suffix += 1) {
    const stem = `cleanup-${stamp}${suffix === 0 ? "" : `-${suffix}`}`;
    const paths = { markdown: join(dir, `${stem}.md`), json: join(dir, `${stem}.json`) };
    let markdownFd: number | undefined;
    let jsonFd: number | undefined;
    let ownsMarkdown = false;
    let ownsJson = false;
    try {
      markdownFd = openSync(paths.markdown, "wx", 0o600);
      ownsMarkdown = true;
      jsonFd = openSync(paths.json, "wx", 0o600);
      ownsJson = true;
      writeFileSync(markdownFd, markdown);
      writeFileSync(jsonFd, json);
      closeSync(markdownFd);
      markdownFd = undefined;
      closeSync(jsonFd);
      jsonFd = undefined;
      return paths;
    } catch (error) {
      if (markdownFd !== undefined) closeSync(markdownFd);
      if (jsonFd !== undefined) closeSync(jsonFd);
      if (ownsMarkdown) unlinkSync(paths.markdown);
      if (ownsJson) unlinkSync(paths.json);
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") continue;
      throw error;
    }
  }
}
