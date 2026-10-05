import { app, clipboard, ipcMain, shell, systemPreferences } from "electron";
import { isAbsolute, join, normalize } from "node:path";
import { homedir } from "node:os";
import { autoUpdater } from "electron-updater";
import { IpcChannel } from "@shared/ipc";
import { assertValidWhisperModelName } from "@shared/whisperModels";
import { KNOWN_PROVIDERS } from "@shared/defaults";
import type { DictionarySuggestion } from "@shared/dictionarySuggestions";
import type {
  AudioVisualFrame,
  CustomCorrection,
  MacOSPermissionState,
  PermissionStatus,
  ProviderApiKey,
  ProviderKeyValidation,
  RecorderFailure,
  RecorderSubmission,
  RecorderSuspensionAck,
  Settings,
  UpdateNotificationPayload
} from "@shared/types";
import { toRecoveryEntryView, type RecoveryEntryView, type RecoveryRestoredNotice, type RecoveryStorageUsage } from "@shared/recovery";
import { DictationService } from "./dictation";
import { HistoryStore } from "./store/history";
import { SettingsStore } from "./store/settings";
import { CredentialsStore, sanitizeSettingsForRenderer } from "./store/credentials";
import { HotkeyManager } from "./hotkeys";
import { nativeBridge } from "./nativeBridge";
import type { RecoveryJournalStore } from "./store/recoveryJournal";
import type { EncryptedRecoveryAudioStore } from "./audio/recoveryAudio";
import { listNativeInputDevices } from "./audio/nativeCapture";
import { getProviderRegistry } from "./providers";
import { detectDictionarySuggestions } from "@shared/dictionarySuggestions";
import { loadWhisperModel, freeWhisperModel, listDownloadedModels, isModelLoaded } from "./providers/local/whisperCpp";
import { cachedUpdateStatus, setCachedUpdateStatus } from "./index";
import { validateSubmittedApiKey } from "./providers/apiKeyValidation";
import { getRecoveryReadiness, isRecoveryReady } from "./recoveryReadiness";
import type { RecoveryReadiness } from "@shared/recoveryReadiness";

function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => {
    const cleaned = v.replace(/^v/, "");
    return cleaned.split(".").map((part) => {
      const num = Number(part);
      return Number.isNaN(num) ? -1 : num;
    });
  };
  const l = parse(latest);
  const c = parse(current);
  if (l.some((n) => n < 0) || c.some((n) => n < 0)) return false;
  const maxLen = Math.max(l.length, c.length);
  for (let i = 0; i < maxLen; i++) {
    const li = l[i] ?? 0;
    const ci = c[i] ?? 0;
    if (li > ci) return true;
    if (li < ci) return false;
  }
  return false;
}

function normalizeMediaStatus(status: string): MacOSPermissionState {
  switch (status) {
    case "not-determined":
    case "granted":
    case "denied":
    case "restricted":
      return status;
    default:
      return "unknown";
  }
}

function getPermissionStatus(): PermissionStatus {
  const accessibilityTrusted = systemPreferences.isTrustedAccessibilityClient(false);
  return {
    microphone: normalizeMediaStatus(systemPreferences.getMediaAccessStatus("microphone")),
    accessibility: accessibilityTrusted ? "granted" : "denied"
  };
}

const MAX_CUSTOM_CORRECTION_TEXT_LENGTH = 40;
const MAX_ID_LENGTH = 256;
const MAX_SHORT_TEXT_LENGTH = 512;
const MAX_TEXT_LENGTH = 100_000;
const MAX_SECRET_LENGTH = 8_192;
const MAX_LIST_LENGTH = 500;
const MAX_CUSTOM_CORRECTION_HIT_COUNT = 1_000_000;
const MAX_AUDIO_DURATION_SECONDS = 600;
const MAX_AUDIO_SAMPLES = 10_000_000;
const MAX_RMS_FRAMES = 100_000;

type IpcSenderEvent = Electron.IpcMainEvent | Electron.IpcMainInvokeEvent;
type IpcWindow = { webContents: { send: (channel: string, ...args: unknown[]) => void }; isDestroyed: () => boolean };

function isSenderAllowed(event: IpcSenderEvent, allowed: Array<IpcWindow | null | undefined>): boolean {
  return allowed.some((window) => (
    !!window && !window.isDestroyed() && event.sender === window.webContents
  ));
}

function requireAllowedSender(event: IpcSenderEvent, allowed: Array<IpcWindow | null | undefined>): void {
  if (!isSenderAllowed(event, allowed)) {
    throw new Error("Unauthorized IPC sender");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isBoundedString(value: unknown, maxLength: number, allowEmpty = true): value is string {
  return typeof value === "string" && value.length <= maxLength && (allowEmpty || value.trim().length > 0);
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function isBoundedStringArray(value: unknown, maxEntries = MAX_LIST_LENGTH, maxText = MAX_SHORT_TEXT_LENGTH): value is string[] {
  return Array.isArray(value)
    && value.length <= maxEntries
    && value.every((entry) => isBoundedString(entry, maxText));
}

function isCustomCorrection(value: unknown): value is CustomCorrection {
  if (!isRecord(value) || !hasOnlyKeys(value, ["spoken", "written", "source", "enabled", "caseSensitive", "wholeWord", "fuzzy", "hitCount", "lastUsedAt"])) return false;
  return isBoundedString(value.spoken, MAX_CUSTOM_CORRECTION_TEXT_LENGTH, false)
    && isBoundedString(value.written, MAX_CUSTOM_CORRECTION_TEXT_LENGTH)
    && (value.source === undefined || isOneOf(value.source, ["auto-suggested", "manual"]))
    && (value.enabled === undefined || typeof value.enabled === "boolean")
    && (value.caseSensitive === undefined || typeof value.caseSensitive === "boolean")
    && (value.wholeWord === undefined || typeof value.wholeWord === "boolean")
    && (value.fuzzy === undefined || typeof value.fuzzy === "boolean")
    && (value.hitCount === undefined || (Number.isInteger(value.hitCount) && isFiniteNumberInRange(value.hitCount, 0, MAX_CUSTOM_CORRECTION_HIT_COUNT)))
    && (value.lastUsedAt === undefined || (isBoundedString(value.lastUsedAt, MAX_SHORT_TEXT_LENGTH, false) && !Number.isNaN(Date.parse(value.lastUsedAt))));
}

function isDictionarySuggestion(value: unknown): value is DictionarySuggestion {
  if (!isRecord(value) || !hasOnlyKeys(value, ["spoken", "written"])) return false;
  return isBoundedString(value.spoken, MAX_CUSTOM_CORRECTION_TEXT_LENGTH, false)
    && isBoundedString(value.written, MAX_CUSTOM_CORRECTION_TEXT_LENGTH, false);
}

function isDictionarySuggestions(value: unknown): value is DictionarySuggestion[] {
  return Array.isArray(value) && value.length <= MAX_LIST_LENGTH && value.every(isDictionarySuggestion);
}

function isProviderApiKey(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["providerId", "key", "hasKey", "lastValidation"])) return false;
  return isBoundedString(value.providerId, MAX_ID_LENGTH, false)
    && isBoundedString(value.key, MAX_SECRET_LENGTH)
    && (value.hasKey === undefined || typeof value.hasKey === "boolean")
    && (value.lastValidation === undefined || value.lastValidation === null || isProviderKeyValidation(value.lastValidation));
}

function isProviderKeyValidation(value: unknown): value is ProviderKeyValidation {
  return isRecord(value)
    && hasOnlyKeys(value, ["valid", "message", "testedAt"])
    && typeof value.valid === "boolean"
    && isBoundedString(value.message, MAX_SHORT_TEXT_LENGTH)
    && isBoundedString(value.testedAt, MAX_SHORT_TEXT_LENGTH, false)
    && !Number.isNaN(Date.parse(value.testedAt));
}

function isSnippet(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["trigger", "content", "matchBareTrigger", "appProfileIds"])) return false;
  return isBoundedString(value.trigger, MAX_SHORT_TEXT_LENGTH, false)
    && isBoundedString(value.content, MAX_TEXT_LENGTH, false)
    && (value.matchBareTrigger === undefined || typeof value.matchBareTrigger === "boolean")
    && (value.appProfileIds === undefined || isBoundedStringArray(value.appProfileIds, 100, MAX_ID_LENGTH));
}

function isAppProfile(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "id", "name", "appBundleIds", "transcriptionProvider", "formattingProvider", "language",
    "stylePreset", "contextAwarenessEnabled", "autoSubmit", "customPrompt",
  ])) return false;
  return isBoundedString(value.id, MAX_ID_LENGTH, false)
    && isBoundedString(value.name, MAX_SHORT_TEXT_LENGTH, false)
    && isBoundedStringArray(value.appBundleIds, 32, MAX_SHORT_TEXT_LENGTH)
    && value.appBundleIds.length > 0
    && (value.transcriptionProvider === undefined || isBoundedString(value.transcriptionProvider, MAX_ID_LENGTH, false))
    && (value.formattingProvider === undefined || isBoundedString(value.formattingProvider, MAX_ID_LENGTH, false))
    && (value.language === undefined || isBoundedString(value.language, 32, false))
    && (value.stylePreset === undefined || isOneOf(value.stylePreset, ["plain", "developer", "casual", "formal", "email"]))
    && (value.contextAwarenessEnabled === undefined || typeof value.contextAwarenessEnabled === "boolean")
    && (value.autoSubmit === undefined || typeof value.autoSubmit === "boolean")
    && (value.customPrompt === undefined || isBoundedString(value.customPrompt, MAX_TEXT_LENGTH));
}

const SETTINGS_VALIDATORS: { [K in keyof Required<Settings>]: (value: unknown) => boolean } = {
  onboardingCompleted: (value) => typeof value === "boolean",
  groqApiKey: (value) => isBoundedString(value, MAX_SECRET_LENGTH),
  primaryHotkey: (value) => isBoundedString(value, MAX_SHORT_TEXT_LENGTH, false),
  pasteLatestHotkey: (value) => isBoundedString(value, MAX_SHORT_TEXT_LENGTH, false),
  language: (value) => isBoundedString(value, 32, false),
  customPrompt: (value) => value === undefined || isBoundedString(value, MAX_TEXT_LENGTH),
  cleanupEnabled: (value) => typeof value === "boolean",
  smartPunctuation: (value) => typeof value === "boolean",
  fillerWords: (value) => isBoundedStringArray(value),
  fillerWordsCustomized: (value) => value === undefined || typeof value === "boolean",
  extraFillerWords: (value) => isBoundedStringArray(value),
  customCorrections: (value) => Array.isArray(value) && value.length <= MAX_LIST_LENGTH && value.every(isCustomCorrection),
  snippets: (value) => Array.isArray(value) && value.length <= MAX_LIST_LENGTH && value.every(isSnippet),
  injectionMode: (value) => isOneOf(value, ["auto", "ax", "clipboard"]),
  pasteMode: (value) => isOneOf(value, ["instant", "animated"]),
  theme: (value) => value === "aurora",
  colorMode: (value) => isOneOf(value, ["light", "dark"]),
  accentColor: (value) => typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value),
  launchAtLogin: (value) => typeof value === "boolean",
  showInDock: (value) => typeof value === "boolean",
  minClipDuration: (value) => isFiniteNumberInRange(value, 0, 60),
  silenceThreshold: (value) => isFiniteNumberInRange(value, 0, 1),
  capsuleBorderWidth: (value) => isFiniteNumberInRange(value, 0, 100),
  capsuleBarRadius: (value) => isFiniteNumberInRange(value, 0, 100),
  capsuleCornerRadius: (value) => isFiniteNumberInRange(value, 0, 100),
  capsuleDesign: (value) => isOneOf(value, ["dot", "bar", "rule", "pill"]),
  dictationMode: (value) => isOneOf(value, ["toggle", "push-to-talk", "toggle-double"]),
  saveRecordings: (value) => typeof value === "boolean",
  recordingsPath: (value) => {
    if (!isBoundedString(value, 4_096)) return false;
    if (value === "") return true;
    const normalized = normalize(value);
    return isAbsolute(value)
      && isAbsolute(normalized)
      && !value.split(/[\\/]+/).includes("..");
  },
  recoveryRetentionDays: (value) => value === 1 || value === 3 || value === 7 || value === 14,
  retainFailedAudio: (value) => typeof value === "boolean",
  transcriptionProvider: (value) => isBoundedString(value, MAX_ID_LENGTH, false),
  transcriptionModel: (value) => isBoundedString(value, MAX_ID_LENGTH),
  formattingProvider: (value) => isBoundedString(value, MAX_ID_LENGTH, false),
  formattingModel: (value) => isBoundedString(value, MAX_ID_LENGTH, false),
  providerApiKeys: (value) => Array.isArray(value) && value.length <= 32 && value.every(isProviderApiKey),
  failoverEnabled: (value) => typeof value === "boolean",
  localWhisperModel: (value) => isBoundedString(value, MAX_ID_LENGTH, false),
  offlineMode: (value) => isOneOf(value, ["auto", "always-offline", "always-online"]),
  contextAwarenessEnabled: (value) => typeof value === "boolean",
  micDeviceId: (value) => value === undefined || isBoundedString(value, MAX_SHORT_TEXT_LENGTH),
  preWarmMic: (value) => typeof value === "boolean",
  captureBackend: (value) => isOneOf(value, ["native", "renderer"]),
  stylePreset: (value) => isOneOf(value, ["plain", "developer", "casual", "formal", "email"]),
  dictionaryOnboarded: (value) => typeof value === "boolean",
  snippetsOnboarded: (value) => typeof value === "boolean",
  setupChecklistDismissed: (value) => typeof value === "boolean",
  appProfiles: (value) => value === undefined || (Array.isArray(value) && value.length <= 100 && value.every(isAppProfile)),
};

function isSettingsPatch(value: unknown): value is Partial<Settings> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, entry]) => {
    const validator = SETTINGS_VALIDATORS[key as keyof Settings];
    return validator !== undefined && validator(entry);
  });
}

function isAudioClip(value: unknown): value is RecorderSubmission["clip"] {
  if (!isRecord(value) || !hasOnlyKeys(value, ["pcmData", "sampleRate", "durationSeconds", "rmsFrames"])) return false;
  if (!isFiniteNumberInRange(value.sampleRate, 8_000, 192_000)) return false;
  if (!isFiniteNumberInRange(value.durationSeconds, 0, MAX_AUDIO_DURATION_SECONDS)) return false;
  if (!Array.isArray(value.pcmData) || value.pcmData.length === 0 || value.pcmData.length > MAX_AUDIO_SAMPLES) return false;
  const sampleCheckCount = Math.min(value.pcmData.length, 4_096);
  const sampleCheckStep = sampleCheckCount === 1
    ? 1
    : (value.pcmData.length - 1) / (sampleCheckCount - 1);
  for (let check = 0; check < sampleCheckCount; check++) {
    const sampleIndex = Math.round(check * sampleCheckStep);
    if (!isFiniteNumberInRange(value.pcmData[sampleIndex], -1, 1)) return false;
  }
  if (Math.abs(value.pcmData.length / value.sampleRate - value.durationSeconds) > 1) return false;
  return Array.isArray(value.rmsFrames)
    && value.rmsFrames.length <= MAX_RMS_FRAMES
    && value.rmsFrames.every((frame) => isFiniteNumberInRange(frame, 0, 1));
}

function isRecorderSubmission(value: unknown): value is RecorderSubmission {
  return isRecord(value)
    && hasOnlyKeys(value, ["sessionId", "clip", "tailMetrics"])
    && isBoundedString(value.sessionId, MAX_ID_LENGTH, false)
    && isAudioClip(value.clip)
    && (value.tailMetrics === undefined || (isRecord(value.tailMetrics)
      && hasOnlyKeys(value.tailMetrics, ["lastFrameAfterStopMs", "trailingRms"])
      && isFiniteNumberInRange(value.tailMetrics.lastFrameAfterStopMs, -MAX_AUDIO_DURATION_SECONDS * 1000, 5_000)
      && isFiniteNumberInRange(value.tailMetrics.trailingRms, 0, 1)));
}

function isAudioVisualFrame(value: unknown): value is AudioVisualFrame {
  return isRecord(value)
    && hasOnlyKeys(value, ["level", "bars"])
    && isFiniteNumberInRange(value.level, 0, 1)
    && Array.isArray(value.bars)
    && value.bars.length > 0
    && value.bars.length <= 64
    && value.bars.every((bar) => isFiniteNumberInRange(bar, 0, 1));
}

function isRecorderFailure(value: unknown): value is RecorderFailure {
  return isRecord(value)
    && hasOnlyKeys(value, ["sessionId", "message", "kind", "partialClip"])
    && isBoundedString(value.sessionId, MAX_ID_LENGTH, false)
    && isBoundedString(value.message, MAX_TEXT_LENGTH, false)
    && (value.kind === undefined || isOneOf(value.kind, ["interrupted", "microphone_permission_denied", "recorder_failure"]))
    && (value.partialClip === undefined || isAudioClip(value.partialClip));
}

function isRecorderSuspensionAck(value: unknown): value is RecorderSuspensionAck {
  return isRecord(value)
    && hasOnlyKeys(value, ["sessionId", "ok", "partialClip", "message"])
    && isBoundedString(value.sessionId, MAX_ID_LENGTH, false)
    && typeof value.ok === "boolean"
    && (value.message === undefined || isBoundedString(value.message, MAX_TEXT_LENGTH, false))
    && (value.partialClip === undefined || isAudioClip(value.partialClip));
}

function sanitizeCustomCorrections(entries: Array<Partial<CustomCorrection>>): CustomCorrection[] {
  return entries.flatMap((entry) => {
    if (!isRecord(entry)
      || !isBoundedString(entry.spoken, MAX_CUSTOM_CORRECTION_TEXT_LENGTH, false)
      || !isBoundedString(entry.written, MAX_CUSTOM_CORRECTION_TEXT_LENGTH)) return [];
    const spoken = entry.spoken.trim();
    const written = entry.written.trim();
    const correction: CustomCorrection = {
      spoken,
      written,
      source: isOneOf(entry.source, ["auto-suggested", "manual"]) ? entry.source : "manual",
    };
    if (typeof entry.enabled === "boolean") correction.enabled = entry.enabled;
    if (typeof entry.caseSensitive === "boolean") correction.caseSensitive = entry.caseSensitive;
    if (typeof entry.wholeWord === "boolean") correction.wholeWord = entry.wholeWord;
    if (typeof entry.fuzzy === "boolean") correction.fuzzy = entry.fuzzy;
    if (Number.isInteger(entry.hitCount) && isFiniteNumberInRange(entry.hitCount, 0, MAX_CUSTOM_CORRECTION_HIT_COUNT)) {
      correction.hitCount = entry.hitCount;
    }
    if (isBoundedString(entry.lastUsedAt, MAX_SHORT_TEXT_LENGTH, false) && !Number.isNaN(Date.parse(entry.lastUsedAt))) {
      correction.lastUsedAt = entry.lastUsedAt;
    }
    return [correction];
  });
}

async function buildRendererApiKeys(
  providerApiKeys: ProviderApiKey[],
  credentials: Pick<CredentialsStore, "has">
): Promise<ProviderApiKey[]> {
  const mapped = await Promise.all(
    providerApiKeys.map(async (pk) => ({
      providerId: pk.providerId,
      key: '',
      hasKey: await credentials.has(pk.providerId),
      lastValidation: pk.lastValidation ?? null,
    }))
  );
  const hasGroq = mapped.some((pk) => pk.providerId === 'groq');
  if (!hasGroq) {
    const groqHasKey = await credentials.has('groq');
    if (groqHasKey) {
      mapped.push({ providerId: 'groq', key: '', hasKey: true, lastValidation: null });
    }
  }
  return mapped;
}

async function openPermissionSettings(permission: keyof PermissionStatus): Promise<void> {
  const pane = permission === "microphone" ? "Privacy_Microphone" : "Privacy_Accessibility";
  await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
}

export interface RegisterIpcHandlersOptions {
  mainWindow: IpcWindow | null;
  dictation: Pick<DictationService, "getState" | "getTrace" | "getActiveSessionForLifecycle" | "reinjectEntry" | "retryEntry" | "copyRecoveryEntry" | "retryRecoveryTranscription" | "retryRecoveryFormatting" | "useRawRecoveryTranscript" | "retryRecoveryInsertion" | "exportBugReport" | "showDictionarySuggestions" | "purgeAutoSuggestedCorrections" | "submitAudioClip" | "reportRecorderReady" | "reportRecorderStarted" | "updateAudioLevel" | "handleRecorderFailure" | "demoTranscribe" | "navigateToHistoryEntry">;
  history: Pick<HistoryStore, "getAll" | "getById" | "updateById" | "getLatest" | "delete" | "clear">;
  settings: Pick<SettingsStore, "get" | "update" | "flush">;
  hotkeys: Pick<HotkeyManager, "isPrimaryHotkeyActive" | "reregister" | "setCaptureActive">;
  recorder?: { getWindow: () => IpcWindow | null; markReady: () => void; acknowledgeLifecycleSuspension?: (ack: RecorderSuspensionAck) => boolean };
  overlay?: { getWindow: () => IpcWindow | null };
  credentials?: Pick<CredentialsStore, "has" | "set" | "delete">;
  recovery?: Pick<RecoveryJournalStore, "getUnresolved" | "getById"> & Partial<Pick<RecoveryJournalStore, "getAll">>;
  recoveryAudio?: Pick<EncryptedRecoveryAudioStore, "deleteAudio" | "discard" | "cleanupExpired" | "getStorageUsage"> & Partial<Pick<EncryptedRecoveryAudioStore, "playDecryptedAudio">>;
  recoveryReady?: () => boolean;
  recoveryReadiness?: () => RecoveryReadiness;
  consumeRestoredRecoveryNotice?: () => RecoveryRestoredNotice | null;
  onSettingsUpdated?: (settings: Settings, patch: Partial<Settings>) => void;
  onPermissionStatusChanged?: (status: PermissionStatus) => void;
}

export function registerIpcHandlers(opts: RegisterIpcHandlersOptions): void {
  const { mainWindow, dictation, history, settings, hotkeys, recorder, overlay, credentials, recovery, recoveryAudio, consumeRestoredRecoveryNotice, onSettingsUpdated, onPermissionStatusChanged } = opts;
  const recoveryReady = opts.recoveryReady ?? isRecoveryReady;
  let lastAccessibilityGranted = getPermissionStatus().accessibility === "granted";
  let lastPermissionHotkeyRefresh = 0;

  function refreshPermissionStatus(): PermissionStatus {
    const current = getPermissionStatus();
    const accessibilityGranted = current.accessibility === "granted";
    const shouldRefreshHotkeys =
      accessibilityGranted &&
      (!lastAccessibilityGranted || !hotkeys.isPrimaryHotkeyActive()) &&
      Date.now() - lastPermissionHotkeyRefresh > 5_000;

    lastAccessibilityGranted = accessibilityGranted;
    if (shouldRefreshHotkeys) {
      lastPermissionHotkeyRefresh = Date.now();
      hotkeys.reregister();
    }
    onPermissionStatusChanged?.(current);
    return current;
  }

  function sendUpdateNotification(payload: UpdateNotificationPayload): void {
    setCachedUpdateStatus(payload);
    mainWindow?.webContents.send(IpcChannel.UpdateNotification, payload);
  }

  async function getSanitizedSettings(): Promise<Settings> {
    const current = settings.get();
    const sanitized = sanitizeSettingsForRenderer(current);
    if (credentials) {
      sanitized.providerApiKeys = await buildRendererApiKeys(current.providerApiKeys ?? [], credentials);
    }
    return sanitized;
  }

  function syncProviderApiKeyMetadata(
    providerId: string,
    hasKey: boolean,
    lastValidation: ProviderKeyValidation | null,
  ): void {
    const current = settings.get().providerApiKeys ?? [];
    const next = current.map((pk) => ({
      providerId: pk.providerId,
      key: "",
      hasKey: pk.hasKey,
      lastValidation: pk.lastValidation ?? null,
    }));
    const provider = next.find((pk) => pk.providerId === providerId);
    if (!provider) {
      next.push({ providerId, key: "", hasKey, lastValidation });
    } else {
      provider.hasKey = hasKey;
      provider.lastValidation = lastValidation;
    }
    settings.update({ providerApiKeys: next });
  }

  ipcMain.handle(IpcChannel.GetDictationState, (event) => {
    requireAllowedSender(event, [mainWindow]);
    return dictation.getState();
  });
  ipcMain.handle(IpcChannel.GetHistory, (event) => {
    requireAllowedSender(event, [mainWindow]);
    return history.getAll();
  });
  ipcMain.handle(IpcChannel.UpdateHistoryEntry, async (event, id: unknown, cleanedText: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isBoundedString(id, MAX_ID_LENGTH, false) || !isBoundedString(cleanedText, MAX_TEXT_LENGTH)) return undefined;
    const entry = await history.getById(id);
    const updated = await history.updateById(id, (entry) => ({ ...entry, cleanedText }));
    
    // Detect if the user made manual word corrections and prompt to save as dictionary rule
    if (entry && updated) {
      const suggestions = detectDictionarySuggestions(entry.cleanedText, updated.cleanedText);
      if (suggestions.length > 0) {
        void dictation.showDictionarySuggestions(suggestions);
      }
    }
    
    return updated;
  });
  ipcMain.handle(IpcChannel.ReinjectEntry, (event, id: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isBoundedString(id, MAX_ID_LENGTH, false)) return undefined;
    return dictation.reinjectEntry(id);
  });
  ipcMain.handle(IpcChannel.RetryHistoryEntry, (event, id: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isBoundedString(id, MAX_ID_LENGTH, false)) return undefined;
    return dictation.retryEntry(id);
  });
  ipcMain.handle(IpcChannel.CopyRecoveryEntry, (event, id: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!recoveryReady() || !isBoundedString(id, MAX_ID_LENGTH, false)) return false;
    return dictation.copyRecoveryEntry(id);
  });
  ipcMain.handle(IpcChannel.GetRecoveryReadiness, async (event): Promise<RecoveryReadiness> => {
    requireAllowedSender(event, [mainWindow]);
    const status = opts.recoveryReadiness?.() ?? getRecoveryReadiness();
    if (status.state !== "ready") return status;
    if (!recovery) return { state: "degraded", entryCount: null };
    try {
      return { state: "ready", entryCount: (await recovery.getUnresolved()).length };
    } catch {
      return { state: "degraded", entryCount: null };
    }
  });
  ipcMain.handle(IpcChannel.GetRecoveryEntries, async (event) => {
    requireAllowedSender(event, [mainWindow]);
    if (!recoveryReady() || !recovery) return [] satisfies RecoveryEntryView[];
    const entries = await recovery.getUnresolved();
    return entries.map(toRecoveryEntryView);
  });
  ipcMain.handle(IpcChannel.GetRecoveryRestored, (event) => {
    requireAllowedSender(event, [mainWindow]);
    return recoveryReady() ? consumeRestoredRecoveryNotice?.() ?? null : null;
  });
  ipcMain.handle(IpcChannel.RetryRecoveryTranscription, (event, id: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!recoveryReady() || !isBoundedString(id, MAX_ID_LENGTH, false)) return false;
    return dictation.retryRecoveryTranscription(id);
  });
  ipcMain.handle(IpcChannel.RetryRecoveryFormatting, (event, id: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!recoveryReady() || !isBoundedString(id, MAX_ID_LENGTH, false)) return false;
    return dictation.retryRecoveryFormatting(id);
  });
  ipcMain.handle(IpcChannel.UseRawRecoveryTranscript, (event, id: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!recoveryReady() || !isBoundedString(id, MAX_ID_LENGTH, false)) return false;
    return dictation.useRawRecoveryTranscript(id);
  });
  ipcMain.handle(IpcChannel.RetryRecoveryInsertion, (event, id: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!recoveryReady() || !isBoundedString(id, MAX_ID_LENGTH, false)) return false;
    return dictation.retryRecoveryInsertion(id);
  });
  ipcMain.handle(IpcChannel.PlayRecoveryAudio, async (event, id: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!recoveryReady() || !isBoundedString(id, MAX_ID_LENGTH, false) || !recovery || !recoveryAudio?.playDecryptedAudio) return false;
    const entry = await recovery.getById(id);
    if (!entry?.audio || entry.terminal) return false;
    await recoveryAudio.playDecryptedAudio(entry.sessionId);
    return true;
  });
  ipcMain.handle(IpcChannel.DeleteRecoveryAudio, async (event, id: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!recoveryReady() || !isBoundedString(id, MAX_ID_LENGTH, false) || !recovery || !recoveryAudio) return false;
    const entry = await recovery.getById(id);
    if (!entry?.audio || entry.terminal) return false;
    await recoveryAudio.deleteAudio(entry.sessionId);
    return true;
  });
  ipcMain.handle(IpcChannel.DiscardRecoveryEntry, async (event, id: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!recoveryReady() || !isBoundedString(id, MAX_ID_LENGTH, false) || !recoveryAudio) return false;
    const entry = await recovery?.getById(id);
    if (!entry || entry.terminal) return false;
    await recoveryAudio.discard(entry.id, entry.sessionId);
    return true;
  });
  ipcMain.handle(IpcChannel.GetRecoveryStorageUsage, async (event) => {
    requireAllowedSender(event, [mainWindow]);
    return recoveryReady() ? recoveryAudio?.getStorageUsage() ?? { bytes: 0, sessions: 0 } satisfies RecoveryStorageUsage : { bytes: 0, sessions: 0 };
  });
  ipcMain.handle(IpcChannel.CleanupRecoveryAudio, async (event) => {
    requireAllowedSender(event, [mainWindow]);
    if (!recoveryReady()) return { bytes: 0, sessions: 0 };
    await recoveryAudio?.cleanupExpired();
    return recoveryAudio?.getStorageUsage() ?? { bytes: 0, sessions: 0 } satisfies RecoveryStorageUsage;
  });
  ipcMain.handle(IpcChannel.ClearRecoveryAudio, async (event) => {
    requireAllowedSender(event, [mainWindow]);
    if (!recoveryReady()) return { bytes: 0, sessions: 0 };
    if (recoveryAudio && recovery) {
      const entries = await recovery.getAll?.() ?? await recovery.getUnresolved();
      for (const entry of entries) {
        if (entry.audio) await recoveryAudio.deleteAudio(entry.sessionId);
      }
    }
    return recoveryAudio?.getStorageUsage() ?? { bytes: 0, sessions: 0 } satisfies RecoveryStorageUsage;
  });
  ipcMain.handle(IpcChannel.GetDictationTrace, (event, traceId: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isBoundedString(traceId, MAX_ID_LENGTH, false)) return undefined;
    return dictation.getTrace(traceId);
  });
  ipcMain.handle(IpcChannel.ExportBugReport, (event, entryId: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isBoundedString(entryId, MAX_ID_LENGTH, false)) return undefined;
    return dictation.exportBugReport(entryId, app.getVersion());
  });
  ipcMain.handle(IpcChannel.DeleteEntry, (event, id: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isBoundedString(id, MAX_ID_LENGTH, false)) return undefined;
    return history.delete(id);
  });
  ipcMain.handle(IpcChannel.ClearHistory, (event) => {
    requireAllowedSender(event, [mainWindow]);
    return history.clear();
  });
  ipcMain.handle(IpcChannel.CopyText, (event, text: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isBoundedString(text, MAX_TEXT_LENGTH)) return false;
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle(IpcChannel.GetSettings, (event) => {
    requireAllowedSender(event, [mainWindow]);
    return getSanitizedSettings();
  });

  ipcMain.handle(IpcChannel.UpdateSettings, async (event, patch: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isSettingsPatch(patch)) return getSanitizedSettings();
    let settingsPatch: Partial<Settings> = { ...patch };

    if ("groqApiKey" in settingsPatch) {
      settingsPatch.groqApiKey = "";
    }
    if ("providerApiKeys" in settingsPatch) {
      const currentKeys = settings.get().providerApiKeys ?? [];
      settingsPatch.providerApiKeys = (settingsPatch.providerApiKeys ?? []).map((pk) => {
        const current = currentKeys.find((entry) => entry.providerId === pk.providerId);
        return {
          providerId: pk.providerId,
          key: "",
          hasKey: current?.hasKey,
          lastValidation: current?.lastValidation ?? null,
        };
      });
    }

    if ("formattingProvider" in settingsPatch && typeof settingsPatch.formattingProvider === "string" && !("formattingModel" in settingsPatch)) {
      const provider = KNOWN_PROVIDERS.find((candidate) => candidate.id === settingsPatch.formattingProvider);
      if (provider?.type === "llm") {
        settingsPatch = { ...settingsPatch, formattingModel: provider.defaultModel };
      }
    }

    if (Array.isArray(settingsPatch.customCorrections)) {
      // Trust model: auto suggestions must pass consent and safety gates before
      // reaching settings; generic settings updates are explicit Dictionary UI
      // edits, so preserve valid metadata while applying shape/length sanity.
      settingsPatch = {
        ...settingsPatch,
        customCorrections: sanitizeCustomCorrections(settingsPatch.customCorrections),
      };
    }

    const updated = settings.update(settingsPatch);
    // Apply privacy restrictions immediately, even while persistence is pending.
    onSettingsUpdated?.(updated, settingsPatch);
    // A consent change must survive restart before the renderer acknowledges it.
    if ("saveRecordings" in settingsPatch || "retainFailedAudio" in settingsPatch) {
      await settings.flush();
    }
    if ("primaryHotkey" in settingsPatch || "pasteLatestHotkey" in settingsPatch) {
      hotkeys.reregister();
    }
    // Update provider registry when provider or key settings change
    if ("transcriptionProvider" in settingsPatch) {
      getProviderRegistry().setActiveTranscription(updated.transcriptionProvider);
    }
    if ("formattingProvider" in settingsPatch) {
      getProviderRegistry().setActiveFormatting(updated.formattingProvider);
    }
    const sanitized = sanitizeSettingsForRenderer(updated);
    if (credentials) {
      sanitized.providerApiKeys = await buildRendererApiKeys(updated.providerApiKeys ?? [], credentials);
    }
    return sanitized;
  });
  ipcMain.handle(IpcChannel.SetHotkeyCapture, (event, active: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (typeof active !== "boolean") return undefined;
    hotkeys.setCaptureActive(active);
  });
  ipcMain.handle(IpcChannel.ShowDictionaryPrompt, (event, suggestions: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isDictionarySuggestions(suggestions)) return undefined;
    return dictation.showDictionarySuggestions(suggestions);
  });
  ipcMain.handle(IpcChannel.PurgeAutoSuggestedCorrections, async (event) => {
    requireAllowedSender(event, [mainWindow]);
    const updated = dictation.purgeAutoSuggestedCorrections();
    const sanitized = sanitizeSettingsForRenderer(updated);
    if (credentials) {
      sanitized.providerApiKeys = await buildRendererApiKeys(updated.providerApiKeys ?? [], credentials);
    }
    return sanitized;
  });
  ipcMain.handle(IpcChannel.GetPermissionStatus, (event) => {
    requireAllowedSender(event, [mainWindow]);
    return refreshPermissionStatus();
  });
  ipcMain.handle(IpcChannel.ListAudioInputDevices, (event) => {
    requireAllowedSender(event, [mainWindow, recorder?.getWindow()]);
    return listNativeInputDevices();
  });
  ipcMain.handle(IpcChannel.RequestMicrophonePermission, async (event) => {
    requireAllowedSender(event, [mainWindow, recorder?.getWindow()]);
    try {
      await systemPreferences.askForMediaAccess("microphone");
    } catch (error) {
      throw error;
    }
    return normalizeMediaStatus(systemPreferences.getMediaAccessStatus("microphone"));
  });
  ipcMain.handle(IpcChannel.RequestAccessibilityPermission, (event) => {
    requireAllowedSender(event, [mainWindow]);
    systemPreferences.isTrustedAccessibilityClient(true);
    const status = refreshPermissionStatus();
    if (status.accessibility !== "granted") {
      return status.accessibility;
    }
    return status.accessibility;
  });
  ipcMain.handle(IpcChannel.OpenPermissionSettings, (event, permission: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isOneOf(permission, ["microphone", "accessibility"])) return undefined;
    return openPermissionSettings(permission);
  });
  ipcMain.handle(IpcChannel.RelaunchApp, (event) => {
    requireAllowedSender(event, [mainWindow]);
    app.relaunch();
    app.quit();
  });

  ipcMain.handle(IpcChannel.SubmitAudioClip, (event, payload: unknown) => {
    requireAllowedSender(event, [recorder?.getWindow()]);
    if (!isRecorderSubmission(payload)) return undefined;
    return dictation.submitAudioClip(payload);
  });
  ipcMain.handle(IpcChannel.RecorderReady, (event) => {
    requireAllowedSender(event, [recorder?.getWindow()]);
    recorder?.markReady();
    dictation.reportRecorderReady();
  });
  ipcMain.handle(IpcChannel.RecorderStarted, (event, sessionId: unknown) => {
    requireAllowedSender(event, [recorder?.getWindow()]);
    if (!isBoundedString(sessionId, MAX_ID_LENGTH, false)) return undefined;
    return dictation.reportRecorderStarted(sessionId);
  });
  ipcMain.handle(IpcChannel.ReportAudioFrame, (event, frame: unknown) => {
    requireAllowedSender(event, [recorder?.getWindow()]);
    if (!isAudioVisualFrame(frame)) return undefined;
    return dictation.updateAudioLevel(frame);
  });
  ipcMain.handle(IpcChannel.RecorderFailure, (event, payload: unknown) => {
    requireAllowedSender(event, [recorder?.getWindow()]);
    if (!isRecorderFailure(payload)) return undefined;
    return dictation.handleRecorderFailure(payload, payload.partialClip);
  });
  ipcMain.handle(IpcChannel.RecorderSuspended, (event, payload: unknown) => {
    requireAllowedSender(event, [recorder?.getWindow()]);
    if (!isRecorderSuspensionAck(payload)) return undefined;
    return recorder?.acknowledgeLifecycleSuspension?.(payload);
  });
  ipcMain.handle(IpcChannel.PrepareRecordingInput, (event) => {
    requireAllowedSender(event, [recorder?.getWindow()]);
    return nativeBridge.prepareRecordingInput?.() ?? null;
  });
  ipcMain.handle(IpcChannel.RestoreRecordingInput, (event, deviceId: unknown) => {
    requireAllowedSender(event, [recorder?.getWindow()]);
    if (typeof deviceId !== "number" || !Number.isSafeInteger(deviceId) || deviceId < 0 || deviceId > 0xFFFF_FFFF) return false;
    return nativeBridge.restoreRecordingInput?.(deviceId) ?? false;
  });
  ipcMain.handle(IpcChannel.GetRecorderConfig, (event) => {
    requireAllowedSender(event, [recorder?.getWindow()]);
    return {
      micDeviceId: settings.get().micDeviceId,
      preWarmMic: settings.get().preWarmMic,
      captureBackend: settings.get().captureBackend,
    };
  });

  // Phase 1: Provider API key testing
  ipcMain.handle(IpcChannel.SetProviderApiKey, async (event, providerId: unknown, apiKey: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isBoundedString(providerId, MAX_ID_LENGTH, false) || !isBoundedString(apiKey, MAX_SECRET_LENGTH, false)) return getSanitizedSettings();
    if (!credentials) return getSanitizedSettings();
    await credentials.set(providerId, apiKey);
    syncProviderApiKeyMetadata(providerId, true, null);
    return getSanitizedSettings();
  });

  ipcMain.handle(IpcChannel.ClearProviderApiKey, async (event, providerId: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isBoundedString(providerId, MAX_ID_LENGTH, false)) return getSanitizedSettings();
    if (!credentials) return getSanitizedSettings();
    await credentials.delete(providerId);
    syncProviderApiKeyMetadata(providerId, false, null);
    return getSanitizedSettings();
  });

  ipcMain.handle(IpcChannel.TestApiKey, async (event, providerId: unknown, apiKey: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isBoundedString(providerId, MAX_ID_LENGTH, false) || !isBoundedString(apiKey, MAX_SECRET_LENGTH, false)) {
      return { valid: false, message: "Invalid provider credentials." };
    }
    const registry = getProviderRegistry();
    const result = await validateSubmittedApiKey(providerId, apiKey, (id) => registry.getTranscription(id) || registry.getFormatting(id));
    const hasKey = credentials
      ? await credentials.has(providerId)
      : settings.get().providerApiKeys?.some((pk) => pk.providerId === providerId && pk.hasKey === true) ?? false;
    syncProviderApiKeyMetadata(providerId, hasKey, { ...result, testedAt: new Date().toISOString() });
    return result;
  });

  ipcMain.handle(IpcChannel.GetProviderStatus, async (event) => {
    requireAllowedSender(event, [mainWindow]);
    const registry = getProviderRegistry();
    const statuses = await registry.getProviderStatus();

    return Promise.all(statuses.map(async (s) => ({
      id: s.id,
      name: s.name,
      available: s.available,
      configured: credentials ? await credentials.has(s.id) : false,
      type: s.type,
    })));
  });

  // Capsule overlay: open last history entry for editing
  ipcMain.on("capsule:open-last-entry", async (event) => {
    if (!isSenderAllowed(event, [overlay?.getWindow()])) return;
    const latest = await history.getLatest();
    if (latest) {
      dictation.navigateToHistoryEntry(latest.id);
    }
  });

  // Demo transcription (bypasses history and injection)
  ipcMain.handle(IpcChannel.DemoTranscribe, async (event, clip: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isAudioClip(clip)) throw new Error("Invalid IPC payload");
    return dictation.demoTranscribe(clip);
  });

  // Manual update check
  ipcMain.handle(IpcChannel.CheckForUpdates, async (event) => {
    requireAllowedSender(event, [mainWindow]);
    try {
      if (app.isPackaged) {
        const result = await autoUpdater.checkForUpdates();
        const latestVersion = result?.updateInfo?.version ?? "";
        const currentVersion = app.getVersion();
        const available = !!latestVersion && isNewerVersion(latestVersion, currentVersion);
        const version = latestVersion || currentVersion;
        if (available) {
          sendUpdateNotification({
            version,
            status: "available",
            message: `Vaani ${version} is available — download from GitHub`,
            installable: false,
          });
        } else {
          sendUpdateNotification({
            version,
            status: "no-update",
            message: "You're on the latest version",
          });
        }
        return { available, version };
      }
      // Development: check GitHub releases API
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let res: Response;
      try {
        res = await fetch("https://api.github.com/repos/Onkarj012/Vaani/releases/latest", {
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
      const data = await res.json() as { tag_name?: string };
      const latestVersion = (data.tag_name ?? "").replace(/^v/, "");
      const currentVersion = app.getVersion();
      const available = !!latestVersion && isNewerVersion(latestVersion, currentVersion);
      const version = latestVersion || currentVersion;
      if (available) {
        sendUpdateNotification({
          version,
          status: "available",
          message: `Vaani ${version} is available — download from GitHub`,
          installable: false,
        });
      } else {
        sendUpdateNotification({
          version,
          status: "no-update",
          message: "You're on the latest version",
        });
      }
      return { available, version };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { available: false, version: app.getVersion() };
      }
      const message = err instanceof Error ? err.message : "Update check failed";
      sendUpdateNotification({
        status: "error",
        message,
      });
      throw new Error(message);
    }
  });

  ipcMain.handle(IpcChannel.GetAppVersion, (event) => {
    requireAllowedSender(event, [mainWindow]);
    return app.getVersion();
  });

  ipcMain.handle(IpcChannel.GetUpdateStatus, (event) => {
    requireAllowedSender(event, [mainWindow]);
    return cachedUpdateStatus;
  });

  ipcMain.on(IpcChannel.QuitAndInstall, (event) => {
    if (!isSenderAllowed(event, [mainWindow])) return;
    autoUpdater.quitAndInstall();
  });

  ipcMain.on(IpcChannel.OpenReleasesPage, (event) => {
    if (!isSenderAllowed(event, [mainWindow])) return;
    void shell.openExternal("https://github.com/Onkarj012/Vaani/releases/latest");
  });

  // Local Whisper model management
  ipcMain.handle(IpcChannel.WhisperListModels, (event) => {
    requireAllowedSender(event, [mainWindow]);
    const modelsDir = join(homedir(), ".vaani", "models");
    return listDownloadedModels(modelsDir);
  });

  ipcMain.handle(IpcChannel.WhisperLoadModel, (event, modelName: unknown) => {
    requireAllowedSender(event, [mainWindow]);
    if (!isBoundedString(modelName, MAX_ID_LENGTH, false)) throw new Error("Invalid IPC payload");
    assertValidWhisperModelName(modelName);
    const modelsDir = join(homedir(), ".vaani", "models");
    const modelPath = join(modelsDir, `ggml-${modelName}.bin`);
    return loadWhisperModel(modelPath);
  });

  ipcMain.handle(IpcChannel.WhisperFreeModel, (event) => {
    requireAllowedSender(event, [mainWindow]);
    freeWhisperModel();
  });

  ipcMain.handle(IpcChannel.WhisperIsModelLoaded, (event) => {
    requireAllowedSender(event, [mainWindow]);
    return isModelLoaded();
  });
}
