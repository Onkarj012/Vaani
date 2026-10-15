// Dev-only: runs a folder of WAV clips through each OpenRouter transcription model and writes a comparison.
// Usage: OPENROUTER_API_KEY=... bun scripts/ab-transcription.ts [--dir ab-test] [--models a,b]

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AudioClip } from "@shared/types";
import { modelEntries, type ModelEntry } from "@shared/modelList";
import { transcribeWithOpenRouter } from "@main/providers/openrouter/openRouterStt";
import { scoreClip, type ClipScore } from "./ab/scoring";

interface ClipInput {
  name: string;
  audio: AudioClip;
  reference: string;
  terms: string[];
}

interface ClipResult {
  clip: string;
  model: string;
  ok: boolean;
  error: string | null;
  transcript: string;
  latencyMs: number;
  costUsd: number | null;
  hintsSent: boolean;
  score: ClipScore;
}

interface ModelSummary {
  model: string;
  displayName: string;
  clips: number;
  failures: number;
  meanWer: number;
  firstWordMisses: number;
  lastWordMisses: number;
  termMisses: number;
  termTotal: number;
  meanLatencyMs: number | null;
  medianLatencyMs: number | null;
  totalCostUsd: number | null;
  costReportedClips: number;
  hintsSent: "yes" | "no" | "partial" | "n/a";
}

// Reads the command line. Flags: --dir <folder> and --models <id,id>.
function parseArgs(argv: string[]): { dir: string; models: string[] | null } {
  let dir = "ab-test";
  let models: string[] | null = null;
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--dir" && value) dir = value;
    else if (flag === "--models" && value) models = value.split(",").map((id) => id.trim()).filter((id) => id.length > 0);
    else throw new Error(`Unknown or incomplete argument: ${flag ?? ""}. Use --dir <folder> and --models <id,id>.`);
  }
  return { dir, models };
}

// Reads a text file as trimmed, non-empty lines. A missing file gives an empty list.
function readLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

// Reads a 16-bit mono PCM WAV, the format Vaani saves, into an AudioClip.
function readWavClip(buffer: Buffer): AudioClip {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a WAV file");
  let offset = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = buffer.readUInt16LE(body);
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bits = buffer.readUInt16LE(body + 14);
    }
    if (id === "data") data = buffer.subarray(body, Math.min(body + size, buffer.length));
    offset = body + size + (size % 2);
  }
  if (format !== 1 || channels !== 1 || bits !== 16 || sampleRate === 0 || !data) throw new Error("expected a 16-bit mono PCM WAV");
  const pcmData: number[] = [];
  for (let i = 0; i + 1 < data.length; i += 2) pcmData.push(data.readInt16LE(i) / 32768);
  return { pcmData, sampleRate, durationSeconds: pcmData.length / sampleRate, rmsFrames: [] };
}

// Pairs each WAV in the clips folder with its reference text. Clips without a usable reference are skipped with a warning.
function loadClips(clipsDir: string, warnings: string[]): ClipInput[] {
  const wavNames = readdirSync(clipsDir).filter((name) => name.toLowerCase().endsWith(".wav")).sort();
  const clips: ClipInput[] = [];
  for (const wavName of wavNames) {
    const base = wavName.slice(0, -4);
    const referencePath = join(clipsDir, `${base}.txt`);
    if (!existsSync(referencePath)) {
      warnings.push(`${wavName}: no ${base}.txt reference, skipped.`);
      continue;
    }
    const reference = readFileSync(referencePath, "utf8").trim();
    if (!reference) {
      warnings.push(`${wavName}: reference text is empty, skipped.`);
      continue;
    }
    try {
      const audio = readWavClip(readFileSync(join(clipsDir, wavName)));
      clips.push({ name: wavName, audio, reference, terms: readLines(join(clipsDir, `${base}.terms.txt`)) });
    } catch (error) {
      warnings.push(`${wavName}: ${errorMessage(error)}, skipped.`);
    }
  }
  return clips;
}

// Sends one clip to one model and scores it. A failed call scores as an empty transcript, so failures count as misses.
async function runClip(model: ModelEntry, clip: ClipInput, apiKey: string, hints: string[]): Promise<ClipResult> {
  const startedAt = performance.now();
  try {
    const reply = await transcribeWithOpenRouter({ clip: clip.audio, apiKey, model: model.modelId, vocabularyHints: hints });
    return {
      clip: clip.name, model: model.modelId, ok: true, error: null, transcript: reply.text,
      latencyMs: performance.now() - startedAt, costUsd: typeof reply.usage?.cost === "number" ? reply.usage.cost : null,
      hintsSent: reply.hintsSent, score: scoreClip(clip.reference, reply.text, clip.terms),
    };
  } catch (error) {
    return {
      clip: clip.name, model: model.modelId, ok: false, error: errorMessage(error), transcript: "",
      latencyMs: performance.now() - startedAt, costUsd: null, hintsSent: false, score: scoreClip(clip.reference, "", clip.terms),
    };
  }
}

// Builds the per-model numbers from that model's clip results.
function summarize(model: ModelEntry, results: ClipResult[], hintTermCount: number): ModelSummary {
  const ok = results.filter((result) => result.ok);
  const latencies = ok.map((result) => result.latencyMs);
  const costs = ok.flatMap((result) => (result.costUsd === null ? [] : [result.costUsd]));
  const hintFlags = ok.map((result) => result.hintsSent);
  return {
    model: model.modelId,
    displayName: model.displayName,
    clips: results.length,
    failures: results.length - ok.length,
    meanWer: mean(results.map((result) => result.score.wer)),
    firstWordMisses: results.filter((result) => result.score.firstWordMissed).length,
    lastWordMisses: results.filter((result) => result.score.lastWordMissed).length,
    termMisses: results.reduce((sum, result) => sum + result.score.missedTerms.length, 0),
    termTotal: results.reduce((sum, result) => sum + result.score.termCount, 0),
    meanLatencyMs: latencies.length ? mean(latencies) : null,
    medianLatencyMs: median(latencies),
    totalCostUsd: costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null,
    costReportedClips: costs.length,
    hintsSent: hintTermCount === 0 || hintFlags.length === 0 ? "n/a" : hintFlags.every(Boolean) ? "yes" : hintFlags.some(Boolean) ? "partial" : "no",
  };
}

// Arithmetic mean. Returns 0 for an empty list.
function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

// Middle value of a list. Returns null for an empty list.
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// Shows a failure as text for the terminal and the report.
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Local time stamp for result file names, such as 2026-10-10_17-06-11.
function timestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

// Builds the Markdown report shown in the terminal and saved next to the JSON.
function renderMarkdown(summaries: ModelSummary[], results: ClipResult[], warnings: string[], clipCount: number, hintTermCount: number): string {
  const lines = [
    `# Transcription A/B results`,
    "",
    `Clips: ${clipCount}. Hint terms sent: ${hintTermCount}.`,
    "",
    "| Model | Clips | Failed | Mean WER | First-word misses | Last-word misses | Term misses | Mean latency (ms) | Median latency (ms) | Total cost | Hints sent |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...summaries.map((s) => {
      const cost = s.totalCostUsd === null ? "not reported" : `$${s.totalCostUsd.toFixed(4)} (${s.costReportedClips}/${s.clips} clips)`;
      return `| ${s.displayName} (\`${s.model}\`) | ${s.clips} | ${s.failures} | ${(s.meanWer * 100).toFixed(1)}% | ${s.firstWordMisses} | ${s.lastWordMisses} | ${s.termMisses}/${s.termTotal} | ${s.meanLatencyMs === null ? "n/a" : Math.round(s.meanLatencyMs)} | ${s.medianLatencyMs === null ? "n/a" : Math.round(s.medianLatencyMs)} | ${cost} | ${s.hintsSent} |`;
    }),
  ];
  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    lines.push("", "## Failed calls", "", ...failures.map((result) => `- \`${result.model}\` on ${result.clip}: ${result.error}`));
  }
  if (warnings.length) {
    lines.push("", "## Skipped files", "", ...warnings.map((warning) => `- ${warning}`));
  }
  return lines.join("\n") + "\n";
}

// Runs the comparison, prints the table, and writes the .md and .json results.
async function main(): Promise<void> {
  const { dir, models: requestedModels } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set. Export it in your shell, then run the script again.");

  const allModels = modelEntries("transcription", "openrouter");
  const unknown = (requestedModels ?? []).filter((id) => !allModels.some((model) => model.modelId === id));
  if (unknown.length) throw new Error(`Unknown model(s): ${unknown.join(", ")}. Choose from: ${allModels.map((model) => model.modelId).join(", ")}.`);
  const models = requestedModels ? allModels.filter((model) => requestedModels.includes(model.modelId)) : allModels;

  const clipsDir = resolve(dir, "clips");
  if (!existsSync(clipsDir)) throw new Error(`No clips folder at ${clipsDir}. See scripts/ab/README.md for how to record the test set.`);
  const warnings: string[] = [];
  const clips = loadClips(clipsDir, warnings);
  if (clips.length === 0) throw new Error(`No usable clips in ${clipsDir}. ${warnings.join(" ") || "Each foo.wav needs a foo.txt reference."}`);
  const hints = readLines(join(resolve(dir), "hints.txt"));

  const results: ClipResult[] = [];
  const total = models.length * clips.length;
  for (const model of models) {
    for (const clip of clips) {
      const result = await runClip(model, clip, apiKey, hints);
      results.push(result);
      const status = result.ok ? `ok ${Math.round(result.latencyMs)} ms` : `failed: ${result.error}`;
      console.error(`[${results.length}/${total}] ${model.modelId} ${clip.name} ${status}`);
    }
  }

  const summaries = models.map((model) => summarize(model, results.filter((result) => result.model === model.modelId), hints.length));
  const markdown = renderMarkdown(summaries, results, warnings, clips.length, hints.length);
  const resultsDir = join(resolve(dir), "results");
  mkdirSync(resultsDir, { recursive: true });
  const stamp = timestamp(new Date());
  writeFileSync(join(resultsDir, `${stamp}.md`), markdown);
  writeFileSync(join(resultsDir, `${stamp}.json`), JSON.stringify({ clipCount: clips.length, hintTerms: hints, summaries, results, warnings }, null, 2) + "\n");

  process.stdout.write(markdown);
  console.error(`Wrote ${join(resultsDir, `${stamp}.md`)} and .json`);
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
