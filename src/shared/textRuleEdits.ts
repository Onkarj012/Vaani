import type { CustomCorrection, Snippet } from "./types";

export type CorrectionEdit = Pick<CustomCorrection, "spoken" | "written">
  & Partial<Pick<CustomCorrection, "enabled" | "caseSensitive" | "wholeWord" | "fuzzy">>;

export type SnippetEdit = Pick<Snippet, "trigger" | "content">
  & Partial<Pick<Snippet, "matchBareTrigger" | "appProfileIds">>;

function normalizedKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function editCorrection(
  corrections: readonly CustomCorrection[],
  originalSpoken: string,
  edit: CorrectionEdit,
): CustomCorrection[] {
  const originalKey = normalizedKey(originalSpoken);
  return corrections.map((correction) => correction.spoken.toLocaleLowerCase() === originalKey
    ? { ...correction, ...edit, spoken: edit.spoken.trim(), written: edit.written.trim() }
    : correction);
}

export function normalizeAppProfileIds(appProfileIds: readonly string[] | undefined): string[] | undefined {
  if (appProfileIds === undefined) return undefined;
  const normalized = [...new Set(appProfileIds.map((id) => id.trim()).filter(Boolean))];
  return normalized.length === 0 ? undefined : normalized;
}

export function editSnippet(
  snippets: readonly Snippet[],
  originalTrigger: string,
  edit: SnippetEdit,
): Snippet[] {
  const originalKey = normalizedKey(originalTrigger);
  const appProfileIds = normalizeAppProfileIds(edit.appProfileIds);
  return snippets.map((snippet) => {
    if (snippet.trigger.toLocaleLowerCase() !== originalKey) return { ...snippet };
    const updated: Snippet = { ...snippet, ...edit, trigger: edit.trigger.trim(), content: edit.content.trim() };
    if (appProfileIds === undefined) delete updated.appProfileIds;
    else updated.appProfileIds = appProfileIds;
    return updated;
  });
}
