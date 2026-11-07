import type { Snippet } from "@shared/types";
import type { ProofSummary } from "@renderer/lib/proofMarks";

// Formats a history timestamp for the row's right-hand time label.
export function historyTimeLabel(timestamp: string, now = new Date()): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (daysAgo === 0) return time;
  if (daysAgo === 1) return `Yesterday, ${time}`;
  return `${date.getDate()} ${date.toLocaleDateString("en-US", { month: "short" })}, ${time}`;
}

// Builds the compact change summary shown under a history transcript.
export function proofSummaryText(summary: ProofSummary): string {
  const parts: string[] = [];
  if (summary.fillers) parts.push(`${summary.fillers} filler${summary.fillers === 1 ? "" : "s"}`);
  const fixes = summary.dictionaryFixes + summary.rewrites;
  if (fixes) parts.push(`${fixes} fix${fixes === 1 ? "" : "es"}`);
  if (summary.scratched) parts.push("scratch");
  return parts.join(", ");
}

// Filters a dictionary rule by its source, enabled state, and search text.
export function matchesDictionaryFilter(
  rule: { spoken: string; written: string; source?: string; enabled?: boolean },
  filter: "all" | "manual" | "auto" | "disabled",
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  const sourceMatches = filter === "all"
    || (filter === "disabled" ? rule.enabled === false : filter === "auto" ? rule.source === "auto-suggested" : rule.source !== "auto-suggested");
  return sourceMatches && (!normalized || `${rule.spoken} ${rule.written}`.toLocaleLowerCase().includes(normalized));
}

// Filters a snippet by its trigger or expanded text.
export function matchesSnippetQuery(snippet: Pick<Snippet, "trigger" | "content">, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  return !normalized || `${snippet.trigger} ${snippet.content}`.toLocaleLowerCase().includes(normalized);
}

// Finds a same-trigger snippet whose app scope overlaps the proposed scope.
export function hasSnippetScopeConflict(
  snippets: readonly Snippet[],
  trigger: string,
  appProfileIds: readonly string[] | undefined,
  editingTrigger?: string | null,
): boolean {
  const normalizedTrigger = trigger.trim().replace(/^\//, "").toLocaleLowerCase();
  const scope = appProfileIds && appProfileIds.length > 0 ? new Set(appProfileIds) : null;
  return snippets.some((snippet) => {
    if (snippet.trigger.toLocaleLowerCase() !== normalizedTrigger
      || snippet.trigger.toLocaleLowerCase() === editingTrigger?.toLocaleLowerCase()) return false;
    const existingScope = snippet.appProfileIds?.length ? new Set(snippet.appProfileIds) : null;
    return !scope || !existingScope || [...scope].some((id) => existingScope.has(id));
  });
}
