import { DEFAULT_SETTINGS } from "./defaults";
import type { AppProfile, CustomCorrection, Settings, Snippet } from "./types";

export const SESSION_SETTINGS_SCHEMA_VERSION = 1;

/** Non-secret settings consumed by transcription, cleanup, and injection for one dictation session. */
export interface SessionSettingsFields {
  language: Settings["language"];
  transcriptionProvider: Settings["transcriptionProvider"];
  transcriptionModel: Settings["transcriptionModel"];
  formattingProvider: Settings["formattingProvider"];
  formattingModel: Settings["formattingModel"];
  customPrompt?: string;
  offlineMode: Settings["offlineMode"];
  failoverEnabled: Settings["failoverEnabled"];
  localWhisperModel: Settings["localWhisperModel"];
  customCorrections: CustomCorrection[];
  snippets: Snippet[];
  appProfiles: AppProfile[];
  stylePreset: Settings["stylePreset"];
  contextAwarenessEnabled: Settings["contextAwarenessEnabled"];
  cleanupEnabled: Settings["cleanupEnabled"];
  smartPunctuation: Settings["smartPunctuation"];
  fillerWords: string[];
  fillerWordsCustomized?: boolean;
  extraFillerWords: string[];
  injectionMode: Settings["injectionMode"];
  silenceThreshold: Settings["silenceThreshold"];
  minClipDuration: Settings["minClipDuration"];
  saveRecordings: Settings["saveRecordings"];
  recordingsPath: Settings["recordingsPath"];
  retainFailedAudio: Settings["retainFailedAudio"];
  recoveryRetentionDays: Settings["recoveryRetentionDays"];
}

export interface SessionSettingsSnapshot extends SessionSettingsFields {
  schemaVersion: typeof SESSION_SETTINGS_SCHEMA_VERSION;
}

type SessionSettingsSource = Omit<SessionSettingsFields, "appProfiles"> & { appProfiles?: AppProfile[] };
type Guard<T> = (value: unknown) => value is T;

export function captureSessionSettings(settings: Settings): SessionSettingsSnapshot {
  return { schemaVersion: SESSION_SETTINGS_SCHEMA_VERSION, ...copyFields(settings) };
}

/** Rebuilds full settings from defaults plus the snapshot. Credentials are never restored. */
export function restoreSessionSettings(snapshot: SessionSettingsSnapshot): Settings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    groqApiKey: "",
    providerApiKeys: [],
    ...copyFields(snapshot),
  };
}

export function parseSessionSettings(value: unknown): SessionSettingsSnapshot | null {
  return isSessionSettingsSnapshot(value)
    ? { schemaVersion: SESSION_SETTINGS_SCHEMA_VERSION, ...copyFields(value) }
    : null;
}

function copyFields(source: SessionSettingsSource): SessionSettingsFields {
  return {
    language: source.language,
    transcriptionProvider: source.transcriptionProvider,
    transcriptionModel: source.transcriptionModel,
    formattingProvider: source.formattingProvider,
    formattingModel: source.formattingModel,
    ...(source.customPrompt === undefined ? {} : { customPrompt: source.customPrompt }),
    offlineMode: source.offlineMode,
    failoverEnabled: source.failoverEnabled,
    localWhisperModel: source.localWhisperModel,
    customCorrections: source.customCorrections.map(copyCorrection),
    snippets: source.snippets.map(copySnippet),
    appProfiles: (source.appProfiles ?? []).map(copyAppProfile),
    stylePreset: source.stylePreset,
    contextAwarenessEnabled: source.contextAwarenessEnabled,
    cleanupEnabled: source.cleanupEnabled,
    smartPunctuation: source.smartPunctuation,
    fillerWords: [...source.fillerWords],
    ...(source.fillerWordsCustomized === undefined ? {} : { fillerWordsCustomized: source.fillerWordsCustomized }),
    extraFillerWords: [...source.extraFillerWords],
    injectionMode: source.injectionMode,
    silenceThreshold: source.silenceThreshold,
    minClipDuration: source.minClipDuration,
    saveRecordings: source.saveRecordings,
    recordingsPath: source.recordingsPath,
    retainFailedAudio: source.retainFailedAudio,
    recoveryRetentionDays: source.recoveryRetentionDays,
  };
}

function copyCorrection(correction: CustomCorrection): CustomCorrection {
  return {
    spoken: correction.spoken,
    written: correction.written,
    ...(correction.source === undefined ? {} : { source: correction.source }),
    ...(correction.enabled === undefined ? {} : { enabled: correction.enabled }),
    ...(correction.caseSensitive === undefined ? {} : { caseSensitive: correction.caseSensitive }),
    ...(correction.wholeWord === undefined ? {} : { wholeWord: correction.wholeWord }),
    ...(correction.fuzzy === undefined ? {} : { fuzzy: correction.fuzzy }),
    ...(correction.hitCount === undefined ? {} : { hitCount: correction.hitCount }),
    ...(correction.lastUsedAt === undefined ? {} : { lastUsedAt: correction.lastUsedAt }),
  };
}

function copySnippet(snippet: Snippet): Snippet {
  return {
    trigger: snippet.trigger,
    content: snippet.content,
    ...(snippet.matchBareTrigger === undefined ? {} : { matchBareTrigger: snippet.matchBareTrigger }),
    ...(snippet.appProfileIds === undefined ? {} : { appProfileIds: [...snippet.appProfileIds] }),
  };
}

function copyAppProfile(profile: AppProfile): AppProfile {
  return {
    id: profile.id,
    name: profile.name,
    appBundleIds: [...profile.appBundleIds],
    ...(profile.transcriptionProvider === undefined ? {} : { transcriptionProvider: profile.transcriptionProvider }),
    ...(profile.formattingProvider === undefined ? {} : { formattingProvider: profile.formattingProvider }),
    ...(profile.language === undefined ? {} : { language: profile.language }),
    ...(profile.stylePreset === undefined ? {} : { stylePreset: profile.stylePreset }),
    ...(profile.contextAwarenessEnabled === undefined ? {} : { contextAwarenessEnabled: profile.contextAwarenessEnabled }),
    ...(profile.autoSubmit === undefined ? {} : { autoSubmit: profile.autoSubmit }),
    ...(profile.customPrompt === undefined ? {} : { customPrompt: profile.customPrompt }),
  };
}

const isString: Guard<string> = (value): value is string => typeof value === "string";
const isBoolean: Guard<boolean> = (value): value is boolean => typeof value === "boolean";
const isFiniteNumber: Guard<number> = (value): value is number => typeof value === "number" && Number.isFinite(value);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptional<T>(value: unknown, guard: Guard<T>): value is T | undefined {
  return value === undefined || guard(value);
}

function isArrayOf<T>(value: unknown, guard: Guard<T>): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

function oneOf<T extends string | number>(values: readonly T[]): Guard<T> {
  return (value): value is T => values.some((candidate) => candidate === value);
}

const isStringArray: Guard<string[]> = (value): value is string[] => isArrayOf(value, isString);
const isOfflineMode = oneOf<Settings["offlineMode"]>(["auto", "always-offline", "always-online"]);
const isInjectionMode = oneOf<Settings["injectionMode"]>(["auto", "ax", "clipboard"]);
const isStylePreset = oneOf<Settings["stylePreset"]>(["plain", "developer", "casual", "formal", "email"]);
const isRetentionDays = oneOf<Settings["recoveryRetentionDays"]>([1, 3, 7, 14]);
const isCorrectionSource = oneOf<NonNullable<CustomCorrection["source"]>>(["auto-suggested", "manual"]);

function isCorrection(value: unknown): value is CustomCorrection {
  return isRecord(value)
    && isString(value.spoken)
    && isString(value.written)
    && isOptional(value.source, isCorrectionSource)
    && isOptional(value.enabled, isBoolean)
    && isOptional(value.caseSensitive, isBoolean)
    && isOptional(value.wholeWord, isBoolean)
    && isOptional(value.fuzzy, isBoolean)
    && isOptional(value.hitCount, isFiniteNumber)
    && isOptional(value.lastUsedAt, isString);
}

function isSnippet(value: unknown): value is Snippet {
  return isRecord(value)
    && isString(value.trigger)
    && isString(value.content)
    && isOptional(value.matchBareTrigger, isBoolean)
    && isOptional(value.appProfileIds, isStringArray);
}

function isAppProfile(value: unknown): value is AppProfile {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isStringArray(value.appBundleIds)
    && isOptional(value.transcriptionProvider, isString)
    && isOptional(value.formattingProvider, isString)
    && isOptional(value.language, isString)
    && isOptional(value.stylePreset, isStylePreset)
    && isOptional(value.contextAwarenessEnabled, isBoolean)
    && isOptional(value.autoSubmit, isBoolean)
    && isOptional(value.customPrompt, isString);
}

function isSessionSettingsSnapshot(value: unknown): value is SessionSettingsSnapshot {
  return isRecord(value)
    && value.schemaVersion === SESSION_SETTINGS_SCHEMA_VERSION
    && isString(value.language)
    && isString(value.transcriptionProvider)
    && isString(value.transcriptionModel)
    && isString(value.formattingProvider)
    && isString(value.formattingModel)
    && isOptional(value.customPrompt, isString)
    && isOfflineMode(value.offlineMode)
    && isBoolean(value.failoverEnabled)
    && isString(value.localWhisperModel)
    && isArrayOf(value.customCorrections, isCorrection)
    && isArrayOf(value.snippets, isSnippet)
    && isArrayOf(value.appProfiles, isAppProfile)
    && isStylePreset(value.stylePreset)
    && isBoolean(value.contextAwarenessEnabled)
    && isBoolean(value.cleanupEnabled)
    && isBoolean(value.smartPunctuation)
    && isStringArray(value.fillerWords)
    && isOptional(value.fillerWordsCustomized, isBoolean)
    && isStringArray(value.extraFillerWords)
    && isInjectionMode(value.injectionMode)
    && isFiniteNumber(value.silenceThreshold)
    && isFiniteNumber(value.minClipDuration)
    && isBoolean(value.saveRecordings)
    && isString(value.recordingsPath)
    && isBoolean(value.retainFailedAudio)
    && isRetentionDays(value.recoveryRetentionDays);
}
