import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { compareCleanupRuns, renderCleanupComparison } from "@scripts/ab/cleanupComparison";
import { cleanupConfigFingerprint } from "@scripts/ab/cleanupScoring";
import { DEFAULT_SETTINGS } from "@shared/defaults";

// Builds a synthetic saved result without personal recordings or API access.
function row(clip = "01.wav", output = "Run bun run test.") {
  return { clip, model: "test-model", input: "run bun run test", expected: "Run bun run test.", output, outcome: "formatted", reason: "Formatted.", latencyMs: 100, costUsd: 0.001 };
}

// Builds a report with a known settings/prompt fingerprint.
function run(rows = [row()]) {
  return { fillers: ["um", "uh"], configFingerprint: "a".repeat(64), results: rows };
}

describe("cleanup regression comparison", () => {
  it("fingerprints only cleanup settings and prompt source, not credentials", () => {
    const baseline = cleanupConfigFingerprint(DEFAULT_SETTINGS, "prompt");
    expect(cleanupConfigFingerprint({ ...DEFAULT_SETTINGS, groqApiKey: "synthetic-test-key" }, "prompt")).toBe(baseline);
    expect(cleanupConfigFingerprint(DEFAULT_SETTINGS, "new prompt")).not.toBe(baseline);
    expect(cleanupConfigFingerprint({ ...DEFAULT_SETTINGS, extraFillerWords: ["like"] }, "prompt")).not.toBe(baseline);
    expect(cleanupConfigFingerprint({ ...DEFAULT_SETTINGS, customCorrections: [{ spoken: "test", written: "TEST" }] }, "prompt")).not.toBe(baseline);
  });
  it("matches clips by name, recomputes scores, and reports improvements and regressions separately", () => {
    const baseline = run([row("01.wav", "Run bun test."), row("02.wav")]);
    const candidate = run([row("02.wav", "Run test."), row("01.wav")]);
    const comparison = compareCleanupRuns(baseline, candidate);
    expect(comparison.clips.map(({ clip, change }) => [clip, change])).toEqual([["01.wav", "improved"], ["02.wav", "regressed"]]);
    expect(comparison.baseline.exactMatches).toBe(1);
    expect(comparison.candidate.exactMatches).toBe(1);
    expect(comparison.regressions).toBe(1);
    expect(comparison.clips[1]?.regressions).toEqual(["Exact match lost", "WER increased"]);
    expect(compareCleanupRuns(run(), { ...run(), results: [{ ...row(), exact: false, wer: 99 }] }).regressions).toBe(0);
  });

  it("distinguishes unchanged, presentation-only, and equal-WER word changes needing review", () => {
    const baseline = run([row("01.wav"), row("02.wav"), row("03.wav", "Run bun run checks.")]);
    const candidate = run([row("03.wav", "Run bun run tests."), row("01.wav"), row("02.wav", "run bun run test")]);
    const comparison = compareCleanupRuns(baseline, candidate);
    expect(comparison.clips.map(({ change }) => change)).toEqual(["unchanged", "presentation-only", "needs-review"]);
    expect(comparison.clips[1]?.regressions).toEqual(["Exact match lost"]);
    expect(comparison.clips[2]?.regressions).toEqual([]);
    expect(compareCleanupRuns(run(), run([row("01.wav", "  Run bun run test.  ")])).clips[0]?.change).toBe("presentation-only");
  });

  it.each(["failed", "timeout"])("flags a new %s even when fallback text is unchanged", (outcome) => {
    const comparison = compareCleanupRuns(run(), { ...run(), results: [{ ...row(), outcome }] });
    expect(comparison.regressions).toBe(1);
    expect(comparison.clips[0]?.regressions).toContain("New failure or timeout");
  });

  it("shows guard changes without treating rejection alone as meaning loss", () => {
    const comparison = compareCleanupRuns(run(), { ...run(), results: [{ ...row(), outcome: "guard-rejected", reason: "Words changed" }] });
    expect(comparison.candidate.guardRejected).toBe(1);
    expect(comparison.clips[0]?.candidate.reason).toBe("Words changed");
    expect(comparison.regressions).toBe(0);
    expect(renderCleanupComparison(comparison)).toContain("Clips needing review: 1");
  });

  it("counts reason-only guard changes for review without flagging a score regression", () => {
    const baseline = run([{ ...row(), outcome: "guard-rejected", reason: "Original rejection" }]);
    const candidate = run([{ ...row(), outcome: "guard-rejected", reason: "Different rejection" }]);
    const comparison = compareCleanupRuns(baseline, candidate);
    expect(comparison.regressions).toBe(0);
    expect(comparison.clips[0]?.change).toBe("unchanged");
    expect(renderCleanupComparison(comparison)).toContain("Clips needing review: 1");
  });

  it("compares latency and cost only on pairs reporting both, with coverage", () => {
    const baseline = { ...run(), results: [row("01.wav"), { ...row("02.wav"), latencyMs: null, costUsd: null }] };
    const candidate = run([{ ...row("01.wav"), latencyMs: 150, costUsd: 0.002 }, row("02.wav")]);
    const comparison = compareCleanupRuns(baseline, candidate);
    expect(comparison.paired).toEqual({ latencyClips: 1, meanLatencyDeltaMs: 50, costClips: 1, totalCostDeltaUsd: 0.001 });
    expect(comparison.baseline.costClips).toBe(1);
    expect(comparison.candidate.costClips).toBe(2);
    expect(compareCleanupRuns({ results: [{ ...row(), latencyMs: null }] }, { results: [{ ...row(), latencyMs: null }] }).paired.totalCostDeltaUsd).toBe(0);
    expect(compareCleanupRuns({ results: [{ ...row(), costUsd: null }] }, { results: [{ ...row(), costUsd: null }] }).paired.totalCostDeltaUsd).toBeNull();
  });

  it("rejects missing clips, duplicate clip/model rows, and changed inputs or references", () => {
    expect(() => compareCleanupRuns(run(), run([row("02.wav")]))).toThrow(/clip sets differ/i);
    expect(() => compareCleanupRuns(run([row(), row()]), run())).toThrow(/duplicate/i);
    expect(() => compareCleanupRuns({ ...run(), clipCount: 2 }, run())).toThrow(/incomplete clip set/i);
    expect(() => compareCleanupRuns(run(), run([{ ...row(), input: "different" }]), { changeNote: "Intentional experiment" })).toThrow(/input differs/i);
    expect(() => compareCleanupRuns(run(), run([{ ...row(), expected: "Different." }]))).toThrow(/reference differs/i);
  });

  it("requires model selection for multi-model runs and a note for model/config changes", () => {
    const other = { ...row(), model: "other-model" };
    expect(() => compareCleanupRuns(run([row(), other]), run())).toThrow(/select/i);
    expect(() => compareCleanupRuns(run(), run([other]))).toThrow(/change-note/i);
    expect(() => compareCleanupRuns(run(), { ...run(), fillers: ["like"] })).toThrow(/change-note/i);
    expect(() => compareCleanupRuns(run(), { ...run(), configFingerprint: "b".repeat(64) })).toThrow(/change-note/i);
    const comparison = compareCleanupRuns(run([row(), other]), run([other]), { baselineModel: "test-model", candidateModel: "other-model", changeNote: "Compare models" });
    expect(comparison.changeNote).toBe("Compare models");
    expect(comparison.baseline.model).toBe("test-model");
    expect(comparison.candidate.model).toBe("other-model");
    expect(() => compareCleanupRuns(run(), run(), { candidateModel: "absent" })).toThrow(/not found/i);
  });

  it("accepts legacy reports but warns that settings and prompt comparability are unverified", () => {
    const comparison = compareCleanupRuns({ results: [row()] }, run());
    expect(comparison.warnings.join(" ")).toMatch(/unverified/i);
    expect(comparison.warnings.join(" ")).toMatch(/fillers/i);
  });

  it.each([
    {},
    { results: [] },
    { results: [null] },
    { results: [{ ...row(), clip: "" }] },
    { results: [{ ...row(), outcome: "unknown" }] },
    { results: [{ ...row(), latencyMs: -1 }] },
    { results: [{ ...row(), costUsd: "0.001" }] },
    { ...run(), fillers: [1] },
    { ...run(), configFingerprint: "invalid" },
  ])("rejects malformed report %# instead of skipping rows", (invalid) => {
    expect(() => compareCleanupRuns(invalid, run())).toThrow();
  });

  it("renders per-clip before/after, reasons, metric deltas, and scoring limits without raw HTML", () => {
    const baseline = run([row("<clip>|.wav", "<script>bad</script> | text")]);
    const comparison = compareCleanupRuns(baseline, run([row("<clip>|.wav")]));
    const markdown = renderCleanupComparison(comparison);
    expect(markdown).toContain("Before");
    expect(markdown).toContain("After");
    expect(markdown).toContain("Expected");
    expect(markdown).toContain("WER");
    expect(markdown).toContain("Paired");
    expect(markdown).toContain("meaning");
    expect(markdown).not.toContain("<script>");
    expect(markdown).toContain("&lt;script&gt;");
  });
});

describe("cleanup comparison CLI", () => {
  it("runs offline, uses exit codes, and never overwrites inputs or existing reports", () => {
    const dir = mkdtempSync(join(tmpdir(), "vaani-ab-compare-"));
    const baseline = join(dir, "baseline.json");
    const candidate = join(dir, "candidate.json");
    const output = join(dir, "comparison.md");
    const script = resolve("scripts/ab-compare.ts");
    const original = JSON.stringify(run());
    writeFileSync(baseline, original);
    writeFileSync(candidate, JSON.stringify(run([row("01.wav", "Run test.")])));
    try {
      const regression = spawnSync("bun", [script, "--baseline", baseline, "--candidate", candidate, "--out", output], { encoding: "utf8" });
      expect(regression.status, regression.stderr).toBe(1);
      expect(readFileSync(output, "utf8")).toContain("regressed: 1");
      const overwrite = spawnSync("bun", [script, "--baseline", baseline, "--candidate", candidate, "--out", baseline], { encoding: "utf8" });
      expect(overwrite.status).toBe(2);
      expect(readFileSync(baseline, "utf8")).toBe(original);
      const existing = spawnSync("bun", [script, "--baseline", baseline, "--candidate", candidate, "--out", output], { encoding: "utf8" });
      expect(existing.status).toBe(2);
      const unchanged = spawnSync("bun", [script, "--baseline", baseline, "--candidate", baseline], { encoding: "utf8" });
      expect(unchanged.status, unchanged.stderr).toBe(0);
      const note = spawnSync("bun", [script, "--baseline", baseline, "--candidate", baseline, "--change-note", "--fillers retest"], { encoding: "utf8" });
      expect(note.status, note.stderr).toBe(0);
      const flagValue = spawnSync("bun", [script, "--baseline", baseline, "--candidate", "--unknown"], { encoding: "utf8" });
      expect(flagValue.status).toBe(2);
      const invalid = spawnSync("bun", [script, "--baseline", baseline], { encoding: "utf8" });
      expect(invalid.status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
