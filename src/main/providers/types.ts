import type { AudioClip, DictationFormatterStatus, TranscriptionResult, TranscriptionOptions, FormattingOptions } from "@shared/types";

export interface ApiKeyValidationResult {
  valid: boolean;
  message: string;
}

// Outcome of one formatter call. `text` is the formatted text when ran, otherwise the input.
export interface FormattingResult {
  status: DictationFormatterStatus;
  reason: string;
  text: string;
}

export interface TranscriptionProvider {
  readonly id: string;
  readonly name: string;
  readonly requiresApiKey: boolean;
  readonly models: { id: string; name: string }[];
  transcribe(clip: AudioClip, options: TranscriptionOptions & { apiKey?: string; baseUrl?: string }): Promise<TranscriptionResult>;
  isAvailable(): Promise<boolean>;
  validateApiKey?(apiKey: string): Promise<ApiKeyValidationResult>;
}

export interface FormattingProvider {
  readonly id: string;
  readonly name: string;
  readonly requiresApiKey: boolean;
  readonly models: { id: string; name: string }[];
  format(rawText: string, options: FormattingOptions & { apiKey?: string }): Promise<FormattingResult>;
  isAvailable(): Promise<boolean>;
  validateApiKey?(apiKey: string): Promise<ApiKeyValidationResult>;
}

export type AnyProvider = TranscriptionProvider | FormattingProvider;

export function isTranscriptionProvider(p: AnyProvider): p is TranscriptionProvider {
  return "transcribe" in p && typeof (p as TranscriptionProvider).transcribe === "function";
}

export function isFormattingProvider(p: AnyProvider): p is FormattingProvider {
  return "format" in p && typeof (p as FormattingProvider).format === "function";
}

// Builds a formatter result. Use "ran" only when the LLM returned the text that is used.
export function formatterResult(status: DictationFormatterStatus, text: string, reason: string): FormattingResult {
  return { status, text, reason };
}

// Reason stored in the trace for an error a formatter adapter caught.
export function formatterErrorReason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Unknown formatter error.";
}
