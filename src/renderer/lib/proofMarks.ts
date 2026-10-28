import type { CustomCorrection } from "@shared/types";

// One piece of the proof view: what Vaani kept, dropped, or rewrote between the raw transcript and the typed text.
export type ProofToken =
  | { kind: "same"; text: string }
  | { kind: "filler"; text: string }
  | { kind: "scratched"; text: string }
  | { kind: "command"; text: string }
  | { kind: "removed"; text: string }
  | { kind: "fix"; from: string; to: string; dictionary: boolean }
  | { kind: "added"; text: string }
  | { kind: "break"; text: string };

export interface ProofSummary {
  fillers: number;
  dictionaryFixes: number;
  rewrites: number;
  scratched: number;
  changed: boolean;
}

interface ProofOptions {
  fillers: readonly string[];
  corrections: readonly Pick<CustomCorrection, "spoken" | "written" | "enabled">[];
}

// Past this many word pairs the word diff gets slow, so long dictations show the typed text unmarked.
const MAX_DIFF_CELLS = 1_000_000;
const COMMANDS = ["scratch that"];

const norm = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const words = (text: string) => text.split(/\s+/).filter(Boolean);
const phraseKey = (text: string) => words(text).map(norm).filter(Boolean).join(" ");

// Diffs the raw transcript against the typed text word by word and labels each change.
export function buildProof(raw: string, cleaned: string, options: ProofOptions): ProofToken[] {
  const a = words(raw);
  // Each typed word with the line break (and indent) before it, so paragraphs and lists keep their shape.
  const typed = [...cleaned.matchAll(/(\s*)(\S+)/g)];
  const b = typed.map((match) => match[2]!);
  const breaks = typed.map((match, j) => (j > 0 && match[1]!.includes("\n") ? match[1]! : ""));
  if (a.length * b.length > MAX_DIFF_CELLS) return [{ kind: "same", text: cleaned }];

  const fillerPhrases = options.fillers.map((f) => words(f).map(norm).filter(Boolean)).filter((p) => p.length > 0)
    .sort((x, y) => y.length - x.length);
  const corrections = options.corrections.filter((c) => c.enabled !== false)
    .map((c) => ({ spoken: phraseKey(c.spoken), written: phraseKey(c.written) }));

  const tokens: ProofToken[] = [];
  let same: string[] = [];
  const push = (token: ProofToken) => {
    if (same.length) tokens.push({ kind: "same", text: same.join(" ") });
    same = [];
    tokens.push(token);
  };

  // Length of the longest filler phrase that starts at dels[i], or 0.
  const fillerAt = (dels: string[], i: number) => {
    for (const phrase of fillerPhrases) {
      if (phrase.every((w, k) => norm(dels[i + k] ?? "") === w)) return phrase.length;
    }
    return 0;
  };

  // Pure deletions: fillers, a "scratch that" with the words it cancelled, or other dropped words.
  const flushDeletion = (dels: string[]) => {
    const keys = dels.map(norm);
    for (const command of COMMANDS) {
      const cmd = command.split(" ");
      const at = keys.findIndex((_, i) => cmd.every((w, k) => keys[i + k] === w));
      if (at >= 0) {
        if (at > 0) push({ kind: "scratched", text: dels.slice(0, at).join(" ") });
        push({ kind: "command", text: dels.slice(at, at + cmd.length).join(" ") });
        if (at + cmd.length < dels.length) flushDeletion(dels.slice(at + cmd.length));
        return;
      }
    }
    let other: string[] = [];
    for (let i = 0; i < dels.length;) {
      const len = fillerAt(dels, i);
      if (len === 0) { other.push(dels[i]!); i++; continue; }
      if (other.length) push({ kind: "removed", text: other.join(" ") });
      other = [];
      push({ kind: "filler", text: dels.slice(i, i + len).join(" ") });
      i += len;
    }
    if (other.length) push({ kind: "removed", text: other.join(" ") });
  };

  const flush = (dels: string[], ins: string[]) => {
    if (!dels.length && !ins.length) return;
    if (!ins.length) { flushDeletion(dels); return; }
    let start = 0;
    for (let len = fillerAt(dels, start); len > 0 && start < dels.length; len = fillerAt(dels, start)) {
      push({ kind: "filler", text: dels.slice(start, start + len).join(" ") });
      start += len;
    }
    const from = dels.slice(start);
    if (!from.length) { push({ kind: "added", text: ins.join(" ") }); return; }
    const fromKey = from.map(norm).filter(Boolean).join(" ");
    const toKey = ins.map(norm).filter(Boolean).join(" ");
    const dictionary = corrections.some((c) => c.spoken === fromKey && c.written === toKey);
    push({ kind: "fix", from: from.join(" "), to: ins.join(" "), dictionary });
  };

  // Longest common subsequence over normalized words, filled from the end so the walk below goes forward.
  const n = a.length, m = b.length;
  const ka = a.map(norm), kb = b.map(norm);
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = ka[i] && ka[i] === kb[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  // Drops raw words whenever that costs no match, so a repeated phrase lines up with its last take (what "scratch that" keeps).
  let dels: string[] = [], ins: string[] = [];
  let i = 0, j = 0;
  // Ends the current run at a line break in the typed text and emits the break.
  const lineBreak = () => {
    if (!breaks[j]) return;
    flush(dels, ins); dels = []; ins = [];
    push({ kind: "break", text: breaks[j]! });
  };
  while (i < n || j < m) {
    if (i < n && lcs[i + 1]![j] === lcs[i]![j]) {
      dels.push(a[i]!); i++;
    } else if (i < n && j < m && ka[i] && ka[i] === kb[j]) {
      flush(dels, ins); dels = []; ins = [];
      lineBreak();
      same.push(b[j]!); i++; j++;
    } else {
      lineBreak();
      ins.push(b[j]!); j++;
    }
  }
  flush(dels, ins);
  if (same.length) tokens.push({ kind: "same", text: same.join(" ") });
  return tokens;
}

// Counts for the legend under the proof view and the one-line summary in lists.
export function summarizeProof(tokens: ProofToken[]): ProofSummary {
  const count = (pred: (t: ProofToken) => boolean) => tokens.filter(pred).length;
  return {
    fillers: count((t) => t.kind === "filler"),
    dictionaryFixes: count((t) => t.kind === "fix" && t.dictionary),
    rewrites: count((t) => (t.kind === "fix" && !t.dictionary) || t.kind === "added" || t.kind === "removed"),
    scratched: count((t) => t.kind === "scratched" || t.kind === "command"),
    changed: tokens.some((t) => t.kind !== "same" && t.kind !== "break"),
  };
}

// Short "2 fillers, 1 fix" line for list rows; empty when only punctuation changed.
export function proofSummaryLine(summary: ProofSummary): string {
  const parts: string[] = [];
  if (summary.fillers) parts.push(`${summary.fillers} filler${summary.fillers > 1 ? "s" : ""}`);
  const fixes = summary.dictionaryFixes + summary.rewrites;
  if (fixes) parts.push(`${fixes} fix${fixes > 1 ? "es" : ""}`);
  if (summary.scratched) parts.push("scratch");
  return parts.join(", ");
}
