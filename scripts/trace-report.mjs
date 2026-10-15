#!/usr/bin/env node
// Prints outcome counts, timings, and STT request counts from the dictation trace file. Never prints transcript text.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_TRACES = join(homedir(), ".vaani-dev", "dictation-traces.json");
const USAGE = "Usage: node scripts/trace-report.mjs [tracesFile] [--last N] [--since ISO]";

// Prints an error and exits. Never includes trace content.
function fail(message) {
  console.error(`${message}\n${USAGE}`);
  process.exit(1);
}

// Reads the command line into a trace file path and optional filters.
function parseArgs(argv) {
  const options = { file: DEFAULT_TRACES, last: null, since: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--last") {
      options.last = Number(argv[++i]);
      if (!Number.isInteger(options.last) || options.last < 1) fail("--last needs a positive whole number.");
    } else if (arg === "--since") {
      options.since = argv[++i] ?? null;
      if (options.since === null || Number.isNaN(Date.parse(options.since))) fail("--since needs an ISO date.");
    } else if (arg.startsWith("--")) {
      fail(`Unknown option ${arg}.`);
    } else {
      options.file = arg;
    }
  }
  return options;
}

// True for a non-null object. Anything else in the trace file is skipped.
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

// Reads the trace file and returns its records, oldest first.
async function loadTraces(file) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`Could not read ${file}: ${error.code ?? "not valid JSON"}.`);
  }
  if (!Array.isArray(parsed)) fail(`${file} does not hold a JSON array.`);
  return parsed.filter(isRecord).sort((a, b) => String(a.startedAt ?? "").localeCompare(String(b.startedAt ?? "")));
}

// Applies --since and --last to the loaded records.
function selectTraces(traces, { since, last }) {
  const sinceTime = since === null ? null : Date.parse(since);
  const inRange = traces.filter((trace) => sinceTime === null || (typeof trace.startedAt === "string" && Date.parse(trace.startedAt) >= sinceTime));
  return last === null ? inRange : inRange.slice(-last);
}

// Returns a finite number field, or null when it is missing.
function numberField(record, key) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Milliseconds from one ISO timestamp field to another, or null when either is missing or the order is backwards.
function spanMs(record, fromKey, toKey) {
  const from = record[fromKey];
  const to = record[toKey];
  if (typeof from !== "string" || typeof to !== "string") return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

// Nearest-rank percentile of an ascending list.
function percentile(sorted, p) {
  return sorted[Math.ceil((p / 100) * sorted.length) - 1];
}

// Provider attempts on a trace, or an empty list when the field is missing.
function attemptsOf(trace) {
  return Array.isArray(trace.providerAttempts) ? trace.providerAttempts.filter(isRecord) : [];
}

// Pads a table cell to a width, right-aligned for numbers.
function cell(text, width, alignRight = false) {
  return alignRight ? String(text).padStart(width) : String(text).padEnd(width);
}

// Timing rows: each metric's p50 and p90 over the traces that have it.
function latencyRows(traces) {
  const metrics = [
    ["release → clip ready", (t) => spanMs(t, "hotkeyReleasedAt", "clipReadyAt")],
    ["STT latency", (t) => numberField(t, "sttLatencyMs")],
    ["formatting latency", (t) => numberField(t, "formattingLatencyMs")],
    ["dispatch → verify done", (t) => spanMs(t, "dispatchAt", "verifyDoneAt")],
    ["release → completed", (t) => spanMs(t, "hotkeyReleasedAt", "completedAt")],
  ];
  return metrics.map(([label, read]) => {
    const values = traces.map(read).filter((value) => value !== null).sort((a, b) => a - b);
    if (values.length === 0) return `  ${cell(label, 24)} no samples`;
    return `  ${cell(label, 24)} p50 ${cell(Math.round(percentile(values, 50)), 7, true)} ms   p90 ${cell(Math.round(percentile(values, 90)), 7, true)} ms   n=${values.length}`;
  });
}

// Counts of traces by outcome, with the percentage of traces that have an outcome.
function outcomeRows(traces) {
  const counts = new Map();
  for (const trace of traces) {
    if (typeof trace.outcome === "string") counts.set(trace.outcome, (counts.get(trace.outcome) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([outcome, count]) => `  ${cell(outcome, 14)} ${cell(count, 5, true)}  ${cell(((count / total) * 100).toFixed(1), 5, true)}%`);
}

// How many STT requests each dictation made, as a distribution.
function requestRows(traces) {
  const counts = new Map();
  for (const trace of traces) {
    if (!Array.isArray(trace.providerAttempts)) continue;
    const requests = attemptsOf(trace).length;
    counts.set(requests, (counts.get(requests) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([requests, dictations]) => `  ${cell(`${requests} request(s)`, 14)} ${cell(dictations, 5, true)} dictations`);
}

// Successful provider attempts grouped by provider and model, with p50 latency.
function successRows(traces) {
  const groups = new Map();
  for (const trace of traces) {
    for (const attempt of attemptsOf(trace)) {
      if (attempt.success !== true || typeof attempt.provider !== "string") continue;
      const key = `${attempt.provider} ${typeof attempt.model === "string" ? attempt.model : "default"}`;
      const group = groups.get(key) ?? { count: 0, latencies: [] };
      group.count += 1;
      const latency = numberField(attempt, "latencyMs");
      if (latency !== null) group.latencies.push(latency);
      groups.set(key, group);
    }
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([key, { count, latencies }]) => {
      const sorted = [...latencies].sort((a, b) => a - b);
      const p50 = sorted.length === 0 ? "n/a" : `${Math.round(percentile(sorted, 50))} ms`;
      return `  ${cell(key, 36)} ${cell(count, 5, true)} ok   p50 ${p50}`;
    });
}

// Prints the whole report for the selected traces.
function printReport(file, traces) {
  const builds = new Map();
  for (const trace of traces) {
    if (typeof trace.buildIdentifier === "string") builds.set(trace.buildIdentifier, (builds.get(trace.buildIdentifier) ?? 0) + 1);
  }
  const first = traces.find((trace) => typeof trace.startedAt === "string")?.startedAt ?? "n/a";
  const last = [...traces].reverse().find((trace) => typeof trace.startedAt === "string")?.startedAt ?? "n/a";

  console.log(`File: ${file}`);
  console.log(`Traces: ${traces.length}   from ${first}   to ${last}`);
  console.log(`Builds: ${builds.size === 0 ? "n/a" : [...builds.entries()].map(([build, count]) => `${build} (${count})`).join(", ")}`);
  console.log("\nOutcomes:");
  console.log(outcomeRows(traces).join("\n") || "  none");
  console.log("\nTimings:");
  console.log(latencyRows(traces).join("\n"));
  console.log("\nSTT requests per dictation:");
  console.log(requestRows(traces).join("\n") || "  none");
  console.log("\nSuccessful attempts by provider and model:");
  console.log(successRows(traces).join("\n") || "  none");
}

const options = parseArgs(process.argv.slice(2));
const traces = selectTraces(await loadTraces(options.file), options);
if (traces.length === 0) {
  console.log(`No traces in ${options.file} match the filters.`);
} else {
  printReport(options.file, traces);
}
