import type { RecoveryEntryView, RecoveryState } from "@shared/recovery";

export type RecoveryAction =
  | "retry-transcription"
  | "retry-formatting"
  | "use-raw-transcript"
  | "retry-insertion"
  | "copy"
  | "play-audio"
  | "delete-audio"
  | "discard";

export type RecoveryFilter = "all" | "needs-transcription" | "needs-formatting" | "ready-to-insert" | "text-only";

export interface RecoveryItemView {
  entry: RecoveryEntryView;
  preview: string;
  age: string;
  expires: string;
  status: string;
  actions: RecoveryAction[];
}

const TERMINAL_STATES: readonly RecoveryState[] = ["delivered", "copied", "discarded", "expired"];

export function deriveRecoveryActions(entry: RecoveryEntryView): RecoveryAction[] {
  if (entry.terminal || TERMINAL_STATES.includes(entry.state)) return [];
  const actions: RecoveryAction[] = [];
  const hasText = Boolean(entry.text.formattedText || entry.text.cleanedText || entry.text.rawTranscript);
  if (entry.audioAvailable && ["captured", "interrupted_recording", "recoverable"].includes(entry.state)) actions.push("retry-transcription");
  if (entry.text.rawTranscript && ["transcript_ready", "recoverable"].includes(entry.state)) actions.push("retry-formatting");
  if (entry.text.rawTranscript && entry.text.formattedText === null && ["transcript_ready", "recoverable", "text_ready"].includes(entry.state)) actions.push("use-raw-transcript");
  if (hasText && ["text_ready", "recoverable"].includes(entry.state)) actions.push("retry-insertion");
  if (hasText && ["transcript_ready", "text_ready", "recoverable"].includes(entry.state)) actions.push("copy");
  if (entry.audioAvailable) {
    actions.push("play-audio", "delete-audio");
  }
  actions.push("discard");
  return actions;
}

export function deriveRecoveryItem(entry: RecoveryEntryView, now = new Date()): RecoveryItemView {
  return {
    entry,
    preview: boundedPreview(entry.text.formattedText ?? entry.text.cleanedText ?? entry.text.rawTranscript ?? "No transcript available."),
    age: formatAge(now.getTime() - Date.parse(entry.createdAt)),
    expires: formatExpiry(entry.retention.audioExpiresAt ?? entry.retention.expiresAt, now),
    status: statusLabel(entry, now),
    actions: deriveRecoveryActions(entry),
  };
}

export function filterRecoveryItems(items: RecoveryItemView[], filter: RecoveryFilter): RecoveryItemView[] {
  return items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "text-only") return item.entry.recoveryMode === "text-only";
    if (filter === "needs-transcription") return item.actions.includes("retry-transcription");
    if (filter === "needs-formatting") return item.actions.includes("retry-formatting");
    return item.actions.includes("retry-insertion");
  });
}

export function matchesRecoverySearch(item: RecoveryItemView, query: string): boolean {
  if (!query) return true;
  const text = item.entry.text;
  return [text.formattedText, text.cleanedText, text.rawTranscript]
    .some((value) => value?.toLowerCase().includes(query.toLowerCase()));
}

export function createRecoveryActionRunner(onBusy: (id: string, busy: boolean) => void, onError: (id: string, message: string | null) => void) {
  const busy = new Set<string>();
  return {
    isBusy: (id: string) => busy.has(id),
    run: async (id: string, action: () => Promise<void | boolean>): Promise<void> => {
      if (busy.has(id)) return;
      busy.add(id);
      onBusy(id, true);
      onError(id, null);
      try {
        if (await action() === false) throw new Error("Recovery action could not be completed. Try again.");
      } catch (error) {
        onError(id, error instanceof Error ? error.message : "Recovery action failed. Try again.");
      } finally {
        busy.delete(id);
        onBusy(id, false);
      }
    },
  };
}

export function dedupeRecoveryEntries(entries: RecoveryEntryView[]): RecoveryEntryView[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function boundedPreview(value: string, maxLength = 180): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function statusLabel(entry: RecoveryEntryView, now: Date): string {
  if (!entry.audioAvailable && entry.retention.audioExpiresAt && Date.parse(entry.retention.audioExpiresAt) <= now.getTime()) {
    return entry.text.formattedText || entry.text.cleanedText || entry.text.rawTranscript
      ? "Audio expired; text available"
      : "Audio expired";
  }
  if (entry.recoveryMode === "text-only") return "Reduced recovery, text only";
  switch (entry.state) {
    case "captured":
    case "interrupted_recording":
      return "Audio ready for transcription";
    case "transcript_ready": return "Transcript ready for formatting";
    case "text_ready": return "Text ready for insertion";
    case "recoverable": return "Needs recovery";
    default: return entry.state.replaceAll("_", " ");
  }
}

function formatAge(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 60_000) return "Less than a minute old";
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}

function formatExpiry(value: string, now: Date): string {
  const expiry = Date.parse(value);
  if (!Number.isFinite(expiry)) return "Expiry unknown";
  const remaining = expiry - now.getTime();
  if (remaining <= 0) return "Audio expired";
  const hours = Math.ceil(remaining / 3_600_000);
  return hours < 24 ? `Audio expires in ${hours}h` : `Audio expires in ${Math.ceil(hours / 24)}d`;
}
