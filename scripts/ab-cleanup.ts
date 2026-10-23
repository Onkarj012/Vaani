// Dev-only: runs each clip's raw text through the cleanup models the way the app does, then scores the result against the expected cleanup.
// Usage: OPENROUTER_API_KEY=... GROQ_API_KEY=... OPENAI_API_KEY=... bun scripts/ab-cleanup.ts [--dir ab-test] [--models a,b] [--fillers like,you know] [--stt-results <results.json> --stt-model <id>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { Settings } from "@shared/types";
import { judgeFormatterReply, stripReasoningBlocks } from "@shared/contentGuard";
import { modelEntries, type ModelEntry } from "@shared/modelList";
import { buildFormattingPrompt, EMPTY_REPLY_REASON, FORMATTED_REASON, liveFormattingTimeoutMs } from "@main/providers/formatting-constants";
import type { FormattingProvider, FormattingResult } from "@main/providers/types";
import { OpenRouterLlmProvider } from "@main/providers/openrouter/openRouterLlm";
import { GroqLlmProvider } from "@main/providers/groq/groqLlm";
import { OpenAILlmProvider } from "@main/providers/openai/openaiLlm";
import { applyDictionary, cleanupText, formatterDropWords, removeSpeechNoise, stripSoundTags } from "@main/text/cleanup";
import { wordErrorRate } from "./ab/scoring";
import { AB_TEST_PROFILE, abPlaceholder, isExactMatch, mean, parseExpectedCleanup, percentile, redactSecrets, transcriptsFromResults } from "./ab/cleanupScoring";

// Models compared when --models is not given. Ids come from src/shared/modelList.ts.
const DEFAULT_MODEL_IDS = ["anthropic/claude-haiku-5.5", "openai/gpt-oss-20b", "gpt-6-luna"];

// The cleanup providers this script can call, with the env var that holds each key.
const CLEANUP_ADAPTERS: Record<string, { adapter: FormattingProvider; envVar: string }> = {
  openrouter: { adapter: OpenRouterLlmProvider, envVar: "OPENROUTER_API_KEY" },
  "groq-llm": { adapter: GroqLlmProvider, envVar: "GROQ_API_KEY" },
  "openai-llm": { adapter: OpenAILlmProvider, envVar: "OPENAI_API_KEY" },
};

type Outcome = "formatted" | "guard-rejected" | "skipped" | "failed" | "timeout";

interface Args {
  dir: string;
  models: string[] | null;
  fillers: string[];
  sttResults: string | null;
  sttModel: string | null;
}

interface RunModel {
  entry: ModelEntry;
  adapter: FormattingProvider;
  apiKey: string;
}

interface ClipInput {
  name: string;
  raw: string;
  expected: string;
}

interface ClipResult {
  clip: string;
  model: string;
  outcome: Outcome;
  reason: string;
  input: string;
  /** The text Vaani would insert after its final cleanup pass. */
  output: string;
  expected: string;
  latencyMs: number | null;
  costUsd: number | null;
  exact: boolean;
  wer: number;
}

interface ModelSummary {
  model: string;
  displayName: string;
  clips: number;
  formatted: number;
  guardRejected: number;
  skipped: number;
  failed: number;
  timeouts: number;
  exactMatches: number;
  meanWer: number | null;
  meanLatencyMs: number | null;
  p90LatencyMs: number | null;
  totalCostUsd: number | null;
  costReportedClips: number;
}

// Reads the command line. Each flag takes one value. --stt-results and --stt-model go together.
function parseArgs(argv: string[]): Args {
  const args: Args = { dir: "ab-test", models: null, fillers: [], sttResults: null, sttModel: null };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? "";
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag || "an argument"}.`);
    if (flag === "--dir") args.dir = value;
    else if (flag === "--models") args.models = splitList(value);
    else if (flag === "--fillers") args.fillers = splitList(value);
    else if (flag === "--stt-results") args.sttResults = value;
    else if (flag === "--stt-model") args.sttModel = value;
    else throw new Error(`Unknown argument: ${flag}. Use --dir, --models, --fillers, --stt-results, or --stt-model.`);
  }
  if (Boolean(args.sttResults) !== Boolean(args.sttModel)) throw new Error("Pass --stt-results and --stt-model together.");
  return args;
}

// Splits a comma list and drops empty items.
function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

// Reads a reference .txt file. A missing or blank file gives undefined.
function readReference(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8").trim() || undefined;
}

// Reads one model's transcripts from an ab-transcription results file.
function readSttTranscripts(path: string, modelId: string): Map<string, string> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return transcriptsFromResults(parsed, modelId);
}

// Pairs each expected row with its input: the .txt reference, or the STT transcript when one is given.
function loadClips(expected: Map<string, string>, clipsDir: string, transcripts: Map<string, string> | null, warnings: string[]): ClipInput[] {
  const clips: ClipInput[] = [];
  for (const [name, expectedText] of expected) {
    const raw = transcripts ? transcripts.get(name) : readReference(join(clipsDir, `${name.slice(0, -".wav".length)}.txt`));
    if (!raw) {
      warnings.push(`${name}: no input text, skipped.`);
      continue;
    }
    clips.push({ name, raw, expected: expectedText });
  }
  return clips;
}

// Removes the configured API keys from text before it is stored or printed.
function redactKeys(text: string): string {
  return redactSecrets(text, Object.values(CLEANUP_ADAPTERS).map(({ envVar }) => process.env[envVar]?.trim() ?? ""));
}

// Applies Vaani's final cleanup before storing and scoring one clip result.
function buildResult(run: RunModel, clip: ClipInput, settings: Settings, reply: { outcome: Outcome; reason: string; output: string; latencyMs: number; costUsd?: number }): ClipResult {
  const output = cleanupText({ rawText: reply.output, settings, skipCorrections: true, placeholderResolver: abPlaceholder });
  return {
    clip: clip.name,
    model: run.entry.modelId,
    outcome: reply.outcome,
    reason: redactKeys(reply.reason),
    input: clip.raw,
    output,
    expected: clip.expected,
    latencyMs: reply.outcome === "skipped" ? null : reply.latencyMs,
    costUsd: reply.costUsd ?? null,
    exact: isExactMatch(clip.expected, output),
    wer: wordErrorRate(clip.expected, output),
  };
}

// Applies dictionary corrections before formatting, then the app's content guard and speech-noise fallback.
async function runClip(run: RunModel, clip: ClipInput, settings: Settings, fillerWords: string[]): Promise<ClipResult> {
  const corrected = applyDictionary(stripSoundTags(clip.raw), settings);
  const fallback = removeSpeechNoise(corrected);
  const language = DEFAULT_SETTINGS.language;
  const timeoutMs = liveFormattingTimeoutMs(run.entry.provider);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const startedAt = performance.now();
  const timedOut = (costUsd?: number) => buildResult(run, clip, settings, { outcome: "timeout", reason: `No reply within ${timeoutMs} ms. Vaani would insert the speech-noise fallback.`, output: fallback, latencyMs: Math.min(performance.now() - startedAt, timeoutMs), costUsd });
  let reply: FormattingResult;
  try {
    reply = await run.adapter.format(corrected, {
      apiKey: run.apiKey,
      model: run.entry.modelId,
      systemPrompt: buildFormattingPrompt({ language, text: corrected, fillerWords }),
      strictSystemPrompt: buildFormattingPrompt({ strict: true, language, text: corrected, fillerWords }),
      fillerWords,
      signal: deadline.signal,
    });
  } catch (error) {
    return deadline.signal.aborted ? timedOut() : buildResult(run, clip, settings, { outcome: "failed", reason: errorMessage(error), output: fallback, latencyMs: performance.now() - startedAt });
  } finally {
    clearTimeout(timer);
  }
  if (deadline.signal.aborted) return timedOut(reply.costUsd);
  const latencyMs = performance.now() - startedAt;
  const costUsd = reply.costUsd;
  if (reply.status === "skipped") return buildResult(run, clip, settings, { outcome: "skipped", reason: reply.reason, output: fallback, latencyMs, costUsd });
  if (reply.status === "rejected") return buildResult(run, clip, settings, { outcome: "guard-rejected", reason: reply.reason, output: fallback, latencyMs, costUsd });
  if (reply.status === "failed") return buildResult(run, clip, settings, { outcome: "failed", reason: reply.reason, output: fallback, latencyMs, costUsd });

  const formatted = stripReasoningBlocks(reply.text);
  if (!formatted) return buildResult(run, clip, settings, { outcome: "failed", reason: EMPTY_REPLY_REASON, output: fallback, latencyMs, costUsd });
  const verdict = judgeFormatterReply(corrected, formatted, fillerWords, { speechNoise: true });
  if (verdict.rejection) return buildResult(run, clip, settings, { outcome: "guard-rejected", reason: verdict.rejection, output: fallback, latencyMs, costUsd });
  return buildResult(run, clip, settings, { outcome: "formatted", reason: FORMATTED_REASON, output: formatted, latencyMs, costUsd });
}

// Builds the per-model numbers from that model's clip results.
function summarize(run: RunModel, results: ClipResult[]): ModelSummary {
  const countOf = (outcome: Outcome) => results.filter((result) => result.outcome === outcome).length;
  const timed = results.flatMap((result) => (result.latencyMs === null ? [] : [result.latencyMs]));
  const costs = results.flatMap((result) => (result.costUsd === null ? [] : [result.costUsd]));
  return {
    model: run.entry.modelId,
    displayName: run.entry.displayName,
    clips: results.length,
    formatted: countOf("formatted"),
    guardRejected: countOf("guard-rejected"),
    skipped: countOf("skipped"),
    failed: countOf("failed"),
    timeouts: countOf("timeout"),
    exactMatches: results.filter((result) => result.exact).length,
    meanWer: mean(results.map((result) => result.wer)),
    meanLatencyMs: mean(timed),
    p90LatencyMs: percentile(timed, 90),
    totalCostUsd: costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null,
    costReportedClips: costs.length,
  };
}

// Local time stamp for result file names, such as 2026-10-10_17-06-11.
function timestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

// Formats a fraction as a percentage with one decimal, or n/a.
function percent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

// Rounds a number of milliseconds, or n/a.
function ms(value: number | null): string {
  return value === null ? "n/a" : String(Math.round(value));
}

// Builds the Markdown report shown in the terminal and saved next to the JSON.
function renderMarkdown(summaries: ModelSummary[], runs: RunModel[], results: ClipResult[], clipNames: string[], inputLabel: string, skippedModels: string[], warnings: string[]): string {
  const lines = [
    "# Cleanup A/B results",
    "",
    `Clips: ${clipNames.length}. Input: ${inputLabel}.`,
    "",
    "| Model | Clips | Formatted | Guard rejected | Skipped | Failed | Timeouts | Exact matches | Mean WER | Mean wait for text to insert (ms) | p90 wait for text to insert (ms) | Total cost |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...summaries.map((s) => {
      const cost = s.totalCostUsd === null ? "not reported" : `$${s.totalCostUsd.toFixed(4)} (${s.costReportedClips}/${s.clips} clips)`;
      return `| ${s.displayName} (\`${s.model}\`) | ${s.clips} | ${s.formatted} | ${s.guardRejected} | ${s.skipped} | ${s.failed} | ${s.timeouts} | ${s.exactMatches} | ${percent(s.meanWer)} | ${ms(s.meanLatencyMs)} | ${ms(s.p90LatencyMs)} | ${cost} |`;
    }),
    "",
    "Wait for text to insert includes answered calls and waits before using the fallback, including failures and timeouts. Skipped clips made no call and are excluded.",
    "",
    "## Per clip",
    "",
    `| Clip | ${runs.map((run) => `\`${run.entry.modelId}\``).join(" | ")} |`,
    `| --- | ${runs.map(() => "---").join(" | ")} |`,
    ...clipNames.map((clip) => {
      const cells = runs.map((run) => {
        const result = results.find((candidate) => candidate.clip === clip && candidate.model === run.entry.modelId);
        if (!result) return "n/a";
        const score = result.exact ? "exact" : `${Math.round(result.wer * 100)}% WER`;
        return result.outcome === "formatted" ? score : `${score} (${result.outcome})`;
      });
      return `| ${clip} | ${cells.join(" | ")} |`;
    }),
  ];
  const failures = results.filter((result) => result.outcome === "failed");
  if (failures.length) lines.push("", "## Failed calls", "", ...failures.map((result) => `- \`${result.model}\` on ${result.clip}: ${result.reason}`));
  if (skippedModels.length) lines.push("", "## Skipped models", "", ...skippedModels.map((line) => `- ${line}`));
  if (warnings.length) lines.push("", "## Skipped files", "", ...warnings.map((warning) => `- ${warning}`));
  return lines.join("\n") + "\n";
}

// Shows a failure as text for the terminal and the report.
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Runs the comparison, prints the table, and writes the .md and .json results.
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const supported = modelEntries("cleanup").flatMap((entry) => {
    const provider = CLEANUP_ADAPTERS[entry.provider];
    return provider ? [{ entry, adapter: provider.adapter, envVar: provider.envVar }] : [];
  });
  const requestedIds = args.models ?? DEFAULT_MODEL_IDS;
  const unknown = requestedIds.filter((id) => !supported.some((model) => model.entry.modelId === id));
  if (unknown.length) throw new Error(`Unknown model(s): ${unknown.join(", ")}. Choose from: ${supported.map((model) => model.entry.modelId).join(", ")}.`);

  const runs: RunModel[] = [];
  const skippedModels: string[] = [];
  for (const model of supported.filter((candidate) => requestedIds.includes(candidate.entry.modelId))) {
    const apiKey = process.env[model.envVar]?.trim() ?? "";
    if (apiKey) runs.push({ entry: model.entry, adapter: model.adapter, apiKey });
    else skippedModels.push(`${model.entry.displayName} (\`${model.entry.modelId}\`): ${model.envVar} is not set, so it was skipped.`);
  }
  if (runs.length === 0) throw new Error("No model has an API key set. Export OPENROUTER_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY, then run the script again.");

  const expected = parseExpectedCleanup(readFileSync(new URL("./ab/recording-script.md", import.meta.url), "utf8"));
  if (expected.size === 0) throw new Error("No expected cleanup rows found in scripts/ab/recording-script.md.");

  const dir = resolve(args.dir);
  const warnings: string[] = [];
  const transcripts = args.sttResults && args.sttModel ? readSttTranscripts(resolve(args.sttResults), args.sttModel) : null;
  const clips = loadClips(expected, join(dir, "clips"), transcripts, warnings);
  if (clips.length === 0) throw new Error(`No usable clips in ${join(dir, "clips")}. ${warnings.join(" ")}`);
  const inputLabel = args.sttModel ? `STT transcripts from ${args.sttResults} (\`${args.sttModel}\`)` : "reference .txt files in clips/";

  const settings: Settings = { ...DEFAULT_SETTINGS, ...AB_TEST_PROFILE, extraFillerWords: [...AB_TEST_PROFILE.extraFillerWords, ...args.fillers] };
  const fillerWords = formatterDropWords(settings);
  const results: ClipResult[] = [];
  const total = runs.length * clips.length;
  for (const run of runs) {
    for (const clip of clips) {
      const result = await runClip(run, clip, settings, fillerWords);
      results.push(result);
      const status = result.latencyMs === null ? result.outcome : `${result.outcome} ${Math.round(result.latencyMs)} ms`;
      console.error(`[${results.length}/${total}] ${run.entry.modelId} ${clip.name} ${status}`);
    }
  }

  const summaries = runs.map((run) => summarize(run, results.filter((result) => result.model === run.entry.modelId)));
  const markdown = renderMarkdown(summaries, runs, results, clips.map((clip) => clip.name), inputLabel, skippedModels, warnings);
  const resultsDir = join(dir, "results");
  mkdirSync(resultsDir, { recursive: true });
  const stamp = timestamp(new Date());
  writeFileSync(join(resultsDir, `cleanup-${stamp}.md`), markdown);
  writeFileSync(join(resultsDir, `cleanup-${stamp}.json`), JSON.stringify({ input: inputLabel, fillers: fillerWords, clipCount: clips.length, summaries, results, skippedModels, warnings }, null, 2) + "\n");

  process.stdout.write(markdown);
  console.error(`Wrote ${join(resultsDir, `cleanup-${stamp}`)}.md and .json`);
}

main().catch((error: unknown) => {
  console.error(redactKeys(errorMessage(error)));
  process.exitCode = 1;
});
