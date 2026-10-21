// Pure helpers for the cleanup A/B script. No network, no file access.

// Reads the expected cleanup for each clip file from the table in recording-script.md.
// Columns: # | File | Say | Expected cleanup | Note. A "<br>" in the expected cell means a new line.
export function parseExpectedCleanup(markdown: string): Map<string, string> {
  const expected = new Map<string, string>();
  for (const line of markdown.split(/\r?\n/)) {
    const cells = line.split("|").map((cell) => cell.trim());
    const file = cells[2]?.replace(/`/g, "") ?? "";
    if (!/^\d{2}$/.test(cells[1] ?? "") || !file.endsWith(".wav") || cells[4] === undefined) continue;
    expected.set(file, cells[4].replace(/<br>/g, "\n"));
  }
  return expected;
}

// Reads the transcripts that ab-transcription.ts wrote for one model, keyed by clip file name. Failed calls are left out.
export function transcriptsFromResults(parsed: unknown, modelId: string): Map<string, string> {
  const results = isRecord(parsed) ? parsed.results : undefined;
  if (!Array.isArray(results)) throw new Error("The file is not an ab-transcription results file.");
  const transcripts = new Map<string, string>();
  for (const row of results.filter(isSttRow)) {
    if (row.model === modelId && row.ok) transcripts.set(row.clip, row.transcript);
  }
  return transcripts;
}

interface SttRow {
  clip: string;
  model: string;
  ok: boolean;
  transcript: string;
}

// True for a non-null object. Checks parsed JSON before it is read.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// True for one row of an ab-transcription results file.
function isSttRow(value: unknown): value is SttRow {
  return isRecord(value) && typeof value.clip === "string" && typeof value.model === "string" && typeof value.ok === "boolean" && typeof value.transcript === "string";
}

// True when both texts match line by line, after trimming and collapsing spaces. Case and punctuation count.
export function isExactMatch(expected: string, actual: string): boolean {
  return normalizeLines(expected) === normalizeLines(actual);
}

// Trims each line, collapses inner spaces, and drops empty lines.
function normalizeLines(text: string): string {
  return text.split("\n").map((line) => line.trim().replace(/\s+/g, " ")).filter((line) => line.length > 0).join("\n");
}

// Replaces each secret value with [redacted]. Empty values are skipped so an unset key cannot match everywhere.
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret) redacted = redacted.replaceAll(secret, "[redacted]");
  }
  return redacted;
}

// Arithmetic mean. Returns null for an empty list.
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Nearest-rank percentile, such as p = 90. Returns null for an empty list.
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? null;
}
