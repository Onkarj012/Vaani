import type { DictationInsertionOutcome, DictationRejectionReason, DictionaryPromptValues, OverlayPromptReply, SnippetPromptValues } from "./types";

export const PROMPT_FIELD_MAX = 80;
export const PROMPT_TEXT_MAX = 2_000;
const TRIGGER_PATTERN = /^[a-z0-9_-]+$/i;

// Drops a leading slash and surrounding space from a typed snippet trigger.
export function normalizeSnippetTrigger(raw: string): string {
  return raw.trim().replace(/^\/+/, "");
}

// First problem with an edited dictionary rule, or null when it can be saved.
export function dictionaryEditError(values: DictionaryPromptValues): string | null {
  const spoken = values.spoken.trim();
  const written = values.written.trim();
  if (!spoken || !written) return "Both fields need text.";
  if (spoken.length > PROMPT_FIELD_MAX || written.length > PROMPT_FIELD_MAX) return `Keep each field under ${PROMPT_FIELD_MAX} characters.`;
  if (spoken === written) return "Heard and Write as are the same.";
  return null;
}

// First problem with an edited snippet, or null when it can be saved.
export function snippetEditError(values: SnippetPromptValues, takenTriggers: readonly string[] = []): string | null {
  const trigger = normalizeSnippetTrigger(values.trigger);
  if (!trigger) return "Add a trigger.";
  if (trigger.length > PROMPT_FIELD_MAX) return `Keep the trigger under ${PROMPT_FIELD_MAX} characters.`;
  if (!TRIGGER_PATTERN.test(trigger)) return "Use letters, numbers, hyphens or underscores.";
  if (takenTriggers.some((taken) => taken.toLowerCase() === trigger.toLowerCase())) return `/${trigger} is already a snippet.`;
  if (!values.text.trim()) return "Add the phrase to insert.";
  if (values.text.length > PROMPT_TEXT_MAX) return "That phrase is too long for a snippet.";
  return null;
}

// Checks a reply from the overlay renderer before main trusts it.
export function isOverlayPromptReply(value: unknown): value is OverlayPromptReply {
  if (typeof value !== "object" || value === null) return false;
  const reply = value as Record<string, unknown>;
  if (typeof reply.id !== "number" || !Number.isInteger(reply.id)) return false;
  if (reply.accepted === false) return Object.keys(reply).length === 2;
  return reply.accepted === true
    && Object.keys(reply).length === 4
    && typeof reply.first === "string" && reply.first.length <= PROMPT_TEXT_MAX
    && typeof reply.second === "string" && reply.second.length <= PROMPT_TEXT_MAX;
}

const REASON_TITLES: Record<DictationRejectionReason, string> = {
  no_speech: "No speech heard",
  microphone_permission_denied: "Microphone blocked",
  fragment: "Too short",
  recorder_unavailable: "Not ready",
  recorder_failure: "Recording failed",
  timeout: "Timed out",
  "stale-session": "Dictation stopped",
  transcription_error: "Transcription failed",
  insertion_failed: "Not inserted",
  cancelled: "Cancelled",
};

const INSERTION_TITLES: Partial<Record<DictationInsertionOutcome, string>> = {
  unconfirmed: "Check the field",
  refused: "Not inserted",
  failed: "Not inserted",
};

// Short error title for the capsule. Null means show the message on its own.
export function overlayErrorTitle(reason: DictationRejectionReason | null, insertion: DictationInsertionOutcome | null): string | null {
  if (insertion && INSERTION_TITLES[insertion]) return INSERTION_TITLES[insertion] ?? null;
  return reason ? REASON_TITLES[reason] : null;
}
