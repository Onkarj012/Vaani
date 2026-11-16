import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCleanupReport } from "@scripts/ab/reportFiles";

describe("cleanup report files", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("keeps both reports when two runs share a timestamp", () => {
    dir = mkdtempSync(join(tmpdir(), "vaani-ab-report-"));

    const first = writeCleanupReport(dir, "2026-11-17_10-30-00", "first markdown", "first json");
    const second = writeCleanupReport(dir, "2026-11-17_10-30-00", "second markdown", "second json");

    expect(second.markdown).not.toBe(first.markdown);
    expect(second.json).not.toBe(first.json);
    expect(readFileSync(first.markdown, "utf8")).toBe("first markdown");
    expect(readFileSync(first.json, "utf8")).toBe("first json");
    expect(readFileSync(second.markdown, "utf8")).toBe("second markdown");
    expect(readFileSync(second.json, "utf8")).toBe("second json");
  });
});
