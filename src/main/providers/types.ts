import type { AudioClip, TranscriptionResult, TranscriptionOptions, FormattingOptions } from "@shared/types";

export interface TranscriptionProvider {
  readonly id: string;
  readonly name: string;
  readonly requiresApiKey: boolean;
  readonly models: { id: string; name: string }[];
  transcribe(clip: AudioClip, options: TranscriptionOptions & { apiKey: string; baseUrl?: string }): Promise<TranscriptionResult>;
  isAvailable(): Promise<boolean>;
}

export interface FormattingProvider {
  readonly id: string;
  readonly name: string;
  readonly requiresApiKey: boolean;
  readonly models: { id: string; name: string }[];
  format(rawText: string, options: FormattingOptions & { apiKey: string }): Promise<string>;
  isAvailable(): Promise<boolean>;
}

export type AnyProvider = TranscriptionProvider | FormattingProvider;

export function isTranscriptionProvider(p: AnyProvider): p is TranscriptionProvider {
  return "transcribe" in p && typeof (p as TranscriptionProvider).transcribe === "function";
}

export function isFormattingProvider(p: AnyProvider): p is FormattingProvider {
  return "format" in p && typeof (p as FormattingProvider).format === "function";
}
