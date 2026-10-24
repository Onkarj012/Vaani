import { isExactMatch, mean } from "./cleanupScoring";
import { normalizeWords, wordErrorRate } from "./scoring";

type Outcome = "formatted" | "guard-rejected" | "skipped" | "failed" | "timeout";
type Change = "unchanged" | "presentation-only" | "improved" | "regressed" | "needs-review";

interface CleanupRow {
  clip: string;
  model: string;
  input: string;
  expected: string;
  output: string;
  outcome: Outcome;
  reason: string;
  latencyMs: number | null;
  costUsd: number | null;
}

interface CleanupRun {
  rows: CleanupRow[];
  fillers: string[] | null;
  configFingerprint: string | null;
  clipCount: number | null;
}

interface ScoredRow extends CleanupRow {
  exact: boolean;
  wer: number;
}

interface Summary {
  model: string;
  exactMatches: number;
  meanWer: number | null;
  guardRejected: number;
  failed: number;
  timeouts: number;
  skipped: number;
  latencyClips: number;
  meanLatencyMs: number | null;
  costClips: number;
  totalCostUsd: number | null;
}

export interface ComparisonOptions {
  baselineModel?: string;
  candidateModel?: string;
  changeNote?: string;
}

export interface CleanupComparison {
  baseline: Summary;
  candidate: Summary;
  changeNote: string | null;
  warnings: string[];
  regressions: number;
  clips: { clip: string; change: Change; regressions: string[]; baseline: ScoredRow; candidate: ScoredRow }[];
  paired: { latencyClips: number; meanLatencyDeltaMs: number | null; costClips: number; totalCostDeltaUsd: number | null };
}

// Checks parsed JSON before reading report fields.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Checks the outcomes written by ab-cleanup.ts.
function isOutcome(value: unknown): value is Outcome {
  return value === "formatted" || value === "guard-rejected" || value === "skipped" || value === "failed" || value === "timeout";
}

// Keeps absent measurements unknown and rejects invalid reported values.
function measurement(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}.`);
  return value;
}

// Validates one saved clip without trusting its stored scores.
function parseRow(value: unknown, index: number): CleanupRow {
  if (!isRecord(value) || typeof value.clip !== "string" || !value.clip.trim() || typeof value.model !== "string" || !value.model.trim()
    || typeof value.input !== "string" || typeof value.expected !== "string" || typeof value.output !== "string"
    || !isOutcome(value.outcome) || typeof value.reason !== "string") throw new Error(`Invalid cleanup result at row ${index + 1}.`);
  return {
    clip: value.clip, model: value.model, input: value.input, expected: value.expected, output: value.output,
    outcome: value.outcome, reason: value.reason,
    latencyMs: measurement(value.latencyMs, `latencyMs at row ${index + 1}`),
    costUsd: measurement(value.costUsd, `costUsd at row ${index + 1}`),
  };
}

// Validates the whole report, including duplicates and optional reproducibility metadata.
function parseRun(value: unknown): CleanupRun {
  if (!isRecord(value) || !Array.isArray(value.results) || value.results.length === 0) throw new Error("Expected a non-empty cleanup results array.");
  const rows = value.results.map(parseRow);
  const seen = new Set<string>();
  for (const row of rows) {
    const key = JSON.stringify([row.model, row.clip]);
    if (seen.has(key)) throw new Error(`Duplicate cleanup result for ${row.model} / ${row.clip}.`);
    seen.add(key);
  }
  let fillers: string[] | null = null;
  if (value.fillers !== undefined) {
    if (!Array.isArray(value.fillers) || !value.fillers.every((item): item is string => typeof item === "string")) throw new Error("Invalid fillers list.");
    fillers = value.fillers;
  }
  let configFingerprint: string | null = null;
  if (value.configFingerprint !== undefined) {
    if (typeof value.configFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.configFingerprint)) throw new Error("Invalid configFingerprint.");
    configFingerprint = value.configFingerprint;
  }
  const clipCount = measurement(value.clipCount, "clipCount");
  if (clipCount !== null && (!Number.isInteger(clipCount) || clipCount === 0)) throw new Error("Invalid clipCount.");
  return { rows, fillers, configFingerprint, clipCount };
}

// Selects exactly one model and rejects incomplete rows against the declared clip count.
function selectRows(run: CleanupRun, requested: string | undefined): { model: string; rows: CleanupRow[] } {
  const models = [...new Set(run.rows.map((row) => row.model))];
  const model = requested ?? (models.length === 1 ? models[0] : undefined);
  if (!model) throw new Error("Multiple models found. Select --baseline-model and --candidate-model explicitly.");
  const rows = run.rows.filter((row) => row.model === model);
  if (rows.length === 0) throw new Error(`Model not found: ${model}.`);
  if (run.clipCount !== null && rows.length !== run.clipCount) throw new Error(`Incomplete clip set for ${model}: ${rows.length}/${run.clipCount}.`);
  return { model, rows };
}

// Scores saved final output with the current shared scorers.
function score(row: CleanupRow): ScoredRow {
  return { ...row, exact: isExactMatch(row.expected, row.output), wer: wordErrorRate(row.expected, row.output) };
}

// Describes output changes without claiming semantic correctness.
function classify(baseline: ScoredRow, candidate: ScoredRow): Change {
  if (baseline.output === candidate.output) return "unchanged";
  if (JSON.stringify(normalizeWords(baseline.output)) === JSON.stringify(normalizeWords(candidate.output))) return "presentation-only";
  if (candidate.wer < baseline.wer) return "improved";
  if (candidate.wer > baseline.wer) return "regressed";
  return "needs-review";
}

// Summarizes scores and measurement coverage for one selected model.
function summarize(model: string, rows: ScoredRow[]): Summary {
  const latency = rows.flatMap((row) => row.latencyMs === null ? [] : [row.latencyMs]);
  const costs = rows.flatMap((row) => row.costUsd === null ? [] : [row.costUsd]);
  return {
    model, exactMatches: rows.filter((row) => row.exact).length, meanWer: mean(rows.map((row) => row.wer)),
    guardRejected: rows.filter((row) => row.outcome === "guard-rejected").length,
    failed: rows.filter((row) => row.outcome === "failed").length, timeouts: rows.filter((row) => row.outcome === "timeout").length,
    skipped: rows.filter((row) => row.outcome === "skipped").length,
    latencyClips: latency.length, meanLatencyMs: mean(latency), costClips: costs.length,
    totalCostUsd: costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null,
  };
}

// Compares identical clip inputs/references and requires declared model or recorded-config changes.
export function compareCleanupRuns(baselineValue: unknown, candidateValue: unknown, options: ComparisonOptions = {}): CleanupComparison {
  const baselineRun = parseRun(baselineValue);
  const candidateRun = parseRun(candidateValue);
  const baseline = selectRows(baselineRun, options.baselineModel);
  const candidate = selectRows(candidateRun, options.candidateModel);
  const changeNote = options.changeNote?.trim() || null;
  const warnings: string[] = [];
  const configChanges: string[] = [];
  if (baseline.model !== candidate.model) configChanges.push("model");
  if (baselineRun.fillers === null || candidateRun.fillers === null) warnings.push("Fillers not recorded in at least one report; filler comparability is unverified.");
  else if (JSON.stringify(baselineRun.fillers) !== JSON.stringify(candidateRun.fillers)) configChanges.push("fillers");
  if (!baselineRun.configFingerprint || !candidateRun.configFingerprint) warnings.push("Legacy report lacks settings/prompt fingerprints; configuration comparability is unverified.");
  else if (baselineRun.configFingerprint !== candidateRun.configFingerprint) configChanges.push("settings/prompt fingerprint");
  if (configChanges.length && !changeNote) throw new Error(`Changed ${configChanges.join(", ")}. Declare the experiment with --change-note.`);
  if (configChanges.length) warnings.push(`Declared changes: ${configChanges.join(", ")}.`);

  const candidateByClip = new Map(candidate.rows.map((row) => [row.clip, row]));
  if (baseline.rows.length !== candidate.rows.length || baseline.rows.some((row) => !candidateByClip.has(row.clip))) throw new Error("Baseline and candidate clip sets differ; compare complete matching sets.");
  const clips: CleanupComparison["clips"] = [];
  for (const row of baseline.rows) {
    const other = candidateByClip.get(row.clip);
    if (!other) throw new Error(`Missing candidate clip: ${row.clip}.`);
    if (row.input !== other.input) throw new Error(`Input differs for ${row.clip}; freeze input before comparing cleanup runs.`);
    if (row.expected !== other.expected) throw new Error(`Reference differs for ${row.clip}; rescore against one frozen reference first.`);
    const before = score(row);
    const after = score(other);
    const regressions: string[] = [];
    if (before.exact && !after.exact) regressions.push("Exact match lost");
    if (after.wer > before.wer) regressions.push("WER increased");
    if ((after.outcome === "failed" || after.outcome === "timeout") && before.outcome !== "failed" && before.outcome !== "timeout") regressions.push("New failure or timeout");
    clips.push({ clip: row.clip, change: classify(before, after), regressions, baseline: before, candidate: after });
  }
  const latencyDeltas = clips.flatMap(({ baseline: before, candidate: after }) => before.latencyMs !== null && after.latencyMs !== null ? [after.latencyMs - before.latencyMs] : []);
  const costDeltas = clips.flatMap(({ baseline: before, candidate: after }) => before.costUsd !== null && after.costUsd !== null ? [after.costUsd - before.costUsd] : []);
  return {
    baseline: summarize(baseline.model, clips.map((clip) => clip.baseline)),
    candidate: summarize(candidate.model, clips.map((clip) => clip.candidate)),
    changeNote, warnings, regressions: clips.filter((clip) => clip.regressions.length > 0).length, clips,
    paired: { latencyClips: latencyDeltas.length, meanLatencyDeltaMs: mean(latencyDeltas), costClips: costDeltas.length, totalCostDeltaUsd: costDeltas.length ? costDeltas.reduce((sum, delta) => sum + delta, 0) : null },
  };
}

// Escapes report text so saved transcripts cannot inject Markdown tables or raw HTML.
function escapeMarkdown(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_{}\[\]()#+.!|~-]/g, "\\$&").replace(/\r?\n/g, "<br>");
}

// Formats an optional measurement without treating missing data as zero.
function number(value: number | null, digits = 2): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

// Renders summary metrics and every clip's before/after text for human review.
export function renderCleanupComparison(report: CleanupComparison): string {
  const count = report.clips.length;
  const before = report.baseline;
  const after = report.candidate;
  const changes: Change[] = ["improved", "regressed", "unchanged", "presentation-only", "needs-review"];
  const lines = [
    "# Cleanup regression comparison", "",
    `Baseline: ${escapeMarkdown(before.model)}. Candidate: ${escapeMarkdown(after.model)}. Clips: ${count}.`,
    `Regressions flagged: ${report.regressions}. These are score/failure signals, not semantic verdicts.`,
    `Clips needing review: ${report.clips.filter((clip) => clip.baseline.output !== clip.candidate.output || clip.baseline.outcome !== clip.candidate.outcome).length}. Includes output or formatter-outcome changes, even without a score regression.`, "",
    ...changes.map((change) => `- ${change}: ${report.clips.filter((clip) => clip.change === change).length}`), "",
    "| Metric | Baseline | Candidate |", "| --- | ---: | ---: |",
    `| Exact matches | ${before.exactMatches}/${count} | ${after.exactMatches}/${count} |`,
    `| Mean normalized WER | ${number(before.meanWer === null ? null : before.meanWer * 100)}% | ${number(after.meanWer === null ? null : after.meanWer * 100)}% |`,
    `| Guard rejected | ${before.guardRejected} | ${after.guardRejected} |`,
    `| Failed / timeout / skipped | ${before.failed} / ${before.timeouts} / ${before.skipped} | ${after.failed} / ${after.timeouts} / ${after.skipped} |`,
    `| Mean latency, ms (reported clips) | ${number(before.meanLatencyMs)} (${before.latencyClips}/${count}) | ${number(after.meanLatencyMs)} (${after.latencyClips}/${count}) |`,
    `| Total cost, USD (reported clips) | ${number(before.totalCostUsd, 6)} (${before.costClips}/${count}) | ${number(after.totalCostUsd, 6)} (${after.costClips}/${count}) |`, "",
    `Paired latency delta, candidate minus baseline: ${number(report.paired.meanLatencyDeltaMs)} ms across ${report.paired.latencyClips}/${count} clips.`,
    `Paired cost delta, candidate minus baseline: ${number(report.paired.totalCostDeltaUsd, 6)} USD across ${report.paired.costClips}/${count} clips.`, "",
    "## Limits", "",
    "WER measures normalized word edits, not meaning. Improved/regressed labels compare WER. Presentation-only means normalized words match, not that punctuation, case or layout are harmless. Equal-WER changed words need review.",
    "New failures/timeouts and lost exact matches are also flagged, even when overall averages improve. Guard changes alone need review, not automatic acceptance or rejection. Latency/cost deltas use paired reported measurements; no latency/cost threshold is applied.",
    "Fingerprints cover recorded benchmark settings and prompt source, not full production parity or model determinism. Code revisions and rejected replies may be unavailable. No baseline is replaced.",
  ];
  if (report.changeNote) lines.push("", `Declared experiment: ${escapeMarkdown(report.changeNote)}`);
  if (report.warnings.length) lines.push("", ...report.warnings.map((warning) => `- ${escapeMarkdown(warning)}`));
  lines.push("", "## Per clip", "");
  for (const clip of report.clips) {
    lines.push(
      `### ${escapeMarkdown(clip.clip)}: ${clip.change}`, "",
      `Signals: ${clip.regressions.length ? clip.regressions.join("; ") : "none"}.`, "",
      `Input: ${escapeMarkdown(clip.baseline.input)}`, "", `Expected: ${escapeMarkdown(clip.baseline.expected)}`, "",
      `Before: ${escapeMarkdown(clip.baseline.output)}`, "", `After: ${escapeMarkdown(clip.candidate.output)}`, "",
      "| Detail | Baseline | Candidate |", "| --- | --- | --- |",
      `| Exact / WER | ${clip.baseline.exact} / ${number(clip.baseline.wer * 100)}% | ${clip.candidate.exact} / ${number(clip.candidate.wer * 100)}% |`,
      `| Outcome | ${clip.baseline.outcome} | ${clip.candidate.outcome} |`,
      `| Reason | ${escapeMarkdown(clip.baseline.reason)} | ${escapeMarkdown(clip.candidate.reason)} |`,
      `| Latency, ms | ${number(clip.baseline.latencyMs)} | ${number(clip.candidate.latencyMs)} |`,
      `| Cost, USD | ${number(clip.baseline.costUsd, 6)} | ${number(clip.candidate.costUsd, 6)} |`, "",
    );
  }
  return lines.join("\n") + "\n";
}
