#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const columns = [
  "id", "time", "app", "duration_bucket", "outcome", "status_text",
  "stop_to_clip_ms", "clip_to_stt_ms", "stt_to_format_ms",
  "format_to_dispatch_ms", "dispatch_to_verify_ms", "verify_to_complete_ms",
  "release_to_complete_ms", "last_frame_after_stop_ms", "trailing_rms_300ms", "build", "landed_once", "usable", "note",
];
const stageColumns = columns.slice(6, 13);
const safeStatusMessages = new Set([
  "Inserted at cursor", "Retry inserted at cursor", "Saved to history",
  "Saved to history; copy text manually", "Saved for recovery", "Copied to clipboard",
  "Dictation cancelled.", "Dictation superseded by a newer session.",
  "Inserted.", "Insertion unconfirmed. Check the field before pasting again.",
  "Not inserted: target changed.", "Copied. Paste when ready.",
  "Insertion unconfirmed. Check the field before pasting again. Find this session in History.",
  "Insertion unconfirmed. Check the field before pasting again. History could not save this session.",
]);
for (const stage of ["Recording", "Transcription", "Processing", "Starting", "Finalizing", "Transcribing", "Transcript quality", "Insertion", "Clipboard", "History", "Dictation"]) {
  for (const location of ["Find this session in History.", "Text is on the clipboard.", "Text was not saved."]) {
    safeStatusMessages.add(`${stage} failed. ${location}`);
  }
}

function paths(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!['--input', '--output'].includes(args[index]) || !args[index + 1]) {
      throw new Error("Usage: node scripts/m1-scorecard.mjs [--input trace.json] [--output scorecard.csv]");
    }
    options.set(args[index], args[index + 1]);
  }
  return {
    input: options.get("--input") ?? join(homedir(), ".vaani", "dictation-traces.json"),
    output: options.get("--output") ?? join(homedir(), ".vaani", "m1-scorecard.csv"),
  };
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ',') {
      row.push(field); field = "";
    } else if (char === '\n') {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (quoted) throw new Error("Existing scorecard has an unterminated CSV field");
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function existingRows(source) {
  const [header, ...data] = parseCsv(source);
  if (!header || !["id", "landed_once", "usable", "note"].every((name) => header.includes(name))) {
    throw new Error("Existing scorecard is missing its id or owner label columns");
  }
  const result = new Map();
  for (const fields of data) {
    if (fields.length !== header.length) throw new Error("Existing scorecard has a malformed row");
    const row = Object.fromEntries(header.map((name, index) => [name, fields[index]]));
    if (row.id) result.set(row.id, row);
  }
  return result;
}

function csvField(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function elapsed(start, end) {
  if (typeof start !== "string" || typeof end !== "string") return "";
  const difference = Date.parse(end) - Date.parse(start);
  return Number.isFinite(difference) && difference >= 0 ? difference : "";
}

function durationBucket(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "unknown";
  if (seconds < 3) return "<3s";
  if (seconds < 10) return "3-10s";
  if (seconds <= 30) return "10-30s";
  return ">30s";
}

function statusText(trace) {
  // Trace messages can contain provider output. Only controlled labels go to the scorecard.
  if (trace.outcome === "verified") return "Inserted.";
  if (trace.outcome === "unconfirmed") return safeStatusMessages.has(trace.userMessage) ? trace.userMessage : "Insertion unconfirmed. Check the field before pasting again.";
  if (trace.outcome === "refused") return "Not inserted: target changed.";
  if (trace.outcome === "copy-only") return "Copied. Paste when ready.";
  if (safeStatusMessages.has(trace.userMessage)) return trace.userMessage;
  if (trace.outcome === "injected") return "Inserted";
  if (trace.outcome === "cancelled") return "Cancelled";
  if (trace.rejectionReason === "no_speech") return "No speech detected";
  if (trace.rejectionReason === "fragment") return "Fragment rejected";
  if (trace.rejectionReason === "recorder_unavailable") return "Recorder unavailable";
  if (trace.rejectionReason === "recorder_failure") return "Recorder failed";
  if (trace.rejectionReason === "timeout") return "Timed out";
  if (trace.rejectionReason === "transcription_error") return "Transcription failed";
  if (trace.rejectionReason === "insertion_failed") return "Insertion unconfirmed or failed";
  if (trace.outcome === "saved") return "Saved to history";
  if (trace.outcome === "started") return "Started";
  return "Failed";
}

function traceRow(trace) {
  return {
    id: trace.sessionId,
    time: trace.startedAt ?? "",
    app: trace.targetAppName || trace.targetAppBundleId || "unknown",
    duration_bucket: durationBucket(trace.rawAudio?.durationSeconds),
    outcome: ["verified", "unconfirmed", "refused", "copy-only", "failed", "started", "injected", "saved", "rejected", "cancelled"].includes(trace.outcome) ? trace.outcome : "unknown",
    status_text: statusText(trace),
    stop_to_clip_ms: elapsed(trace.stopRequestedAt ?? trace.hotkeyReleasedAt, trace.clipReadyAt),
    clip_to_stt_ms: elapsed(trace.clipReadyAt, trace.sttDoneAt),
    stt_to_format_ms: elapsed(trace.sttDoneAt, trace.formatDoneAt),
    format_to_dispatch_ms: elapsed(trace.formatDoneAt, trace.dispatchAt),
    dispatch_to_verify_ms: elapsed(trace.dispatchAt, trace.verifyDoneAt),
    verify_to_complete_ms: elapsed(trace.verifyDoneAt, trace.completedAt),
    release_to_complete_ms: elapsed(trace.hotkeyReleasedAt ?? trace.stopRequestedAt, trace.completedAt),
    last_frame_after_stop_ms: typeof trace.lastFrameAfterStopMs === "number" && Number.isFinite(trace.lastFrameAfterStopMs) ? trace.lastFrameAfterStopMs : "",
    trailing_rms_300ms: typeof trace.trailingRms === "number" && Number.isFinite(trace.trailingRms) ? trace.trailingRms : "",
    build: typeof trace.buildIdentifier === "string" && /^[\w.+-]{1,64}$/.test(trace.buildIdentifier) ? trace.buildIdentifier : "unknown",
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return "n/a";
  const sorted = [...values].sort((a, b) => a - b);
  return String(sorted[Math.ceil(sorted.length * fraction) - 1]);
}

function printSummary(rows) {
  const counts = new Map();
  const failures = new Map();
  for (const row of rows) {
    counts.set(row.outcome, (counts.get(row.outcome) ?? 0) + 1);
    if (row.outcome !== "verified" && row.outcome !== "injected" && row.outcome !== "cancelled") failures.set(row.app, (failures.get(row.app) ?? 0) + 1);
  }
  console.log(`Sessions: ${rows.length}; outcomes: ${[...counts].map(([key, count]) => `${key}=${count}`).join(", ") || "none"}`);
  console.log(`Builds: ${[...new Set(rows.map((row) => row.build || "unknown"))].join(", ")}`);
  console.log(`Per-app failures: ${[...failures].map(([app, count]) => `${app}=${count}`).join(", ") || "none"}`);
  for (const column of stageColumns) {
    const values = rows.flatMap((row) => row[column] === "" || row[column] === undefined ? [] : [Number(row[column])]).filter(Number.isFinite);
    console.log(`${column}: p50=${percentile(values, 0.5)}ms p90=${percentile(values, 0.9)}ms (n=${values.length})`);
  }
}

async function main() {
  const { input, output } = paths(process.argv.slice(2));
  const traces = JSON.parse(await readFile(input, "utf8"));
  if (!Array.isArray(traces)) throw new Error("Trace store must contain an array");
  let previous = new Map();
  try { previous = existingRows(await readFile(output, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }

  const seenSessions = new Set();
  for (const trace of traces) {
    if (!trace || typeof trace.sessionId !== "string" || trace.sessionId === "" || seenSessions.has(trace.sessionId)) continue;
    seenSessions.add(trace.sessionId);
    const row = traceRow(trace);
    const old = previous.get(row.id);
    previous.set(row.id, {
      ...row,
      landed_once: old?.landed_once ?? "",
      usable: old?.usable ?? "",
      note: old?.note ?? "",
    });
  }
  const lines = [columns.join(","), ...[...previous.values()].map((row) => columns.map((name) => csvField(row[name])).join(","))];
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${lines.join("\n")}\n`, "utf8");
  printSummary([...previous.values()]);
}

main().catch(() => {
  console.error("Scorecard failed. Check the trace input and existing CSV format.");
  process.exitCode = 1;
});
