// Dev-only: compares two saved cleanup runs without API calls or baseline replacement.
// Usage: bun scripts/ab-compare.ts --baseline baseline.json --candidate candidate.json [--baseline-model id] [--candidate-model id] [--change-note "prompt experiment"] [--out comparison.md]

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compareCleanupRuns, renderCleanupComparison } from "./ab/cleanupComparison";

const USAGE = "bun scripts/ab-compare.ts --baseline <json> --candidate <json> [--baseline-model <id>] [--candidate-model <id>] [--change-note <text>] [--out <new.md>]";

// Reads explicit input paths and rejects repeated or unknown flags.
function parseArgs(argv: string[]): Map<string, string> {
  const allowed = new Set(["--baseline", "--candidate", "--baseline-model", "--candidate-model", "--change-note", "--out"]);
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? "";
    const value = argv[i + 1];
    if (!allowed.has(flag) || args.has(flag) || !value?.trim() || (flag !== "--change-note" && value.startsWith("--"))) throw new Error(`Invalid argument: ${flag}.\nUsage: ${USAGE}`);
    args.set(flag, value);
  }
  if (!args.has("--baseline") || !args.has("--candidate")) throw new Error(`Pass --baseline and --candidate.\nUsage: ${USAGE}`);
  return args;
}

// Parses a report without including its contents in a JSON syntax error.
function readReport(path: string): unknown {
  const contents = readFileSync(resolve(path), "utf8");
  try {
    const parsed: unknown = JSON.parse(contents);
    return parsed;
  } catch {
    throw new Error("Invalid JSON in a cleanup report.");
  }
}

// Prints the comparison and writes an optional new private report, never overwriting a file.
function main(): void {
  if (process.argv.slice(2).length === 1 && process.argv[2] === "--help") {
    console.log(USAGE);
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  const baseline = args.get("--baseline");
  const candidate = args.get("--candidate");
  if (!baseline || !candidate) throw new Error("Both cleanup reports are required.");
  const report = compareCleanupRuns(readReport(baseline), readReport(candidate), {
    baselineModel: args.get("--baseline-model"),
    candidateModel: args.get("--candidate-model"),
    changeNote: args.get("--change-note"),
  });
  const markdown = renderCleanupComparison(report);
  const out = args.get("--out");
  if (out) writeFileSync(resolve(out), markdown, { flag: "wx", mode: 0o600 });
  process.stdout.write(markdown);
  process.exitCode = report.regressions > 0 ? 1 : 0;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Cleanup comparison failed.");
  process.exitCode = 2;
}
