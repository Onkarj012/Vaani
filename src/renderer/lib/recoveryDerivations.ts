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
    preview: boundedPreview(entry.text.formattedText ?? entry.text.cleanedText ?? entry.text.rawTranscript ?? "No transcript yet."),
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

function hasRecoveryText(entry: RecoveryEntryView): boolean {
  return Boolean(entry.text.formattedText || entry.text.cleanedText || entry.text.rawTranscript);
}

// History shows this as the recovery heading, so it names what happened and the next step.
function statusLabel(entry: RecoveryEntryView, now: Date): string {
  const text = hasRecoveryText(entry);
  if (!entry.audioAvailable && entry.retention.audioExpiresAt && Date.parse(entry.retention.audioExpiresAt) <= now.getTime()) {
    return text ? "The recording expired. The text is still here." : "The recording expired.";
  }
  if (entry.recoveryMode === "text-only" && (entry.state === "captured" || entry.state === "interrupted_recording")) {
    return "Only the text was saved. The recording is gone.";
  }
  switch (entry.state) {
    case "captured":
    case "interrupted_recording":
      return "Recording saved. Transcribe it to get the words back.";
    case "transcript_ready":
      return "Transcript ready. Format it, or use the raw text.";
    case "text_ready":
      return "Ready to paste back.";
    case "recoverable":
      return recoverableStatus(entry);
    case "capturing":
      return "Still recording.";
    case "transcribing":
      return "Transcribing the recording.";
    case "formatting":
      return "Formatting the transcript.";
    case "inserting":
      return "Inserting the text.";
    case "retry_wait":
      return "Waiting to retry.";
    case "delivered":
      return "Inserted.";
    case "copied":
      return "Copied.";
    case "discarded":
      return "Discarded.";
    case "expired":
      return text ? "This item expired. The text is still here." : "This item has expired.";
  }
}

function recoverableStatus(entry: RecoveryEntryView): string {
  const textOnly = entry.recoveryMode === "text-only";
  switch (entry.lastError.class) {
    case "transcription_error":
    case "transient_network":
    case "rate_limit":
    case "provider_5xx":
    case "authentication":
      return textOnly
        ? "Transcription didn't finish, and the recording wasn't kept. Copy any text that was saved."
        : "Transcription didn't finish. Retry, or copy any text that was saved.";
    case "formatting_error":
      return "Formatting didn't finish. Retry, use the raw text, or copy it.";
    case "insertion_failed":
    case "permission_denied":
      return "The text didn't land in the app. Copy it, or try inserting again.";
    case "timeout":
    case "stale_session":
      return "This took too long. Retry, or copy the text.";
    case "no_speech":
      return "No speech was detected. Record again, or discard this.";
    case "microphone_permission_denied":
      return "Microphone access was denied. Allow it in System Settings, then retry.";
    case "recorder_failure":
    case "malformed_audio":
    case "device_unavailable":
    case "audio_route_changed":
    case "native_load_failure":
      return textOnly
        ? "The recording didn't finish. Only the text was saved."
        : "The recording didn't finish. Retry if the audio is still here.";
    case "interrupted":
    case "aborted":
      return textOnly
        ? "Recording was interrupted. Only the text was saved."
        : "Recording was interrupted. Transcribe what's saved, or discard it.";
    case "storage_failure":
    case "recovery_storage_failure":
    case "recovery_cap_reached":
    case "recovery_key_unavailable":
    case "recovery_key_corrupt":
      return "The recording couldn't be kept. Copy the text if it's here.";
    case "invalid_config":
      return "Vaani wasn't set up to finish this. Check Settings, or copy the text.";
    case "expired":
      return hasRecoveryText(entry) ? "This item expired. The text is still here." : "This item has expired.";
    case "none":
    case "unknown":
      return textOnly
        ? "Didn't finish. Only the text was saved, so copy it or try inserting it."
        : "Didn't finish. Retry, or copy the text.";
  }
}

function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatAge(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 60_000) return "Less than a minute ago";
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) return `${countPhrase(minutes, "minute", "minutes")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${countPhrase(hours, "hour", "hours")} ago`;
  return `${countPhrase(Math.floor(hours / 24), "day", "days")} ago`;
}

function formatExpiry(value: string, now: Date): string {
  const expiry = Date.parse(value);
  if (!Number.isFinite(expiry)) return "No expiry time was saved.";
  const remaining = expiry - now.getTime();
  if (remaining <= 0) return "Recording expired.";
  const hours = Math.ceil(remaining / 3_600_000);
  return hours < 24
    ? `Recording expires in ${countPhrase(hours, "hour", "hours")}.`
    : `Recording expires in ${countPhrase(Math.ceil(hours / 24), "day", "days")}.`;
}
