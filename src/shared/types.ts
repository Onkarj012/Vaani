import type { RecoveryReadiness } from "./recoveryReadiness";
import type { DictionarySuggestion } from "./dictionarySuggestions";
import type { RecoveryEntryView, RecoveryInsertionTerminalOutcome, RecoveryRestoredNotice, RecoveryStorageUsage } from "./recovery";
export type {
  RecoveryAttempt,
  RecoveryEntry,
  RecoveryEntryView,
  RecoveryError,
  RecoveryErrorClass,
  RecoveryInsertionOutcome,
  RecoveryInsertionView,
  RecoveryInsertionPreparation,
  RecoveryInsertionTerminalOutcome,
  RecoveryProviderAttempt,
  RecoveryRetention,
  RecoveryRetentionMetadata,
  RecoveryMode,
  RecoveryState,
  RecoveryTarget,
  RecoveryTargetFingerprint,
  RecoveryTerminal,
  RecoveryTerminalOutcome,
  RecoveryTextReferences,
  RecoveryTransitionInput,
  RecoveryRestoredNotice,
  RecoveryStorageUsage,
} from "./recovery";

// ─── Dictation State ─────────────────────────────────────────────────────────

export type DictationStatus = "idle" | "starting" | "recording" | "finalizing" | "transcribing" | "completed" | "error";
export type DictationCompletionOutcome = "injected" | "saved";
export type InjectionMethod = "ax" | "clipboard";
export type InjectionFailureReason =
  | "permission_missing"
  | "no_editable_target"
  | "insertion_failed"
  | "activation_failed"
  | "cancelled"
  | "target_changed"
  | "outcome_uncertain";
export type DictationMode = "toggle" | "push-to-talk" | "toggle-double";

export interface SelectionRange {
  location: number;
  length: number;
}

export type DictationState =
  | { status: "idle" }
  | { status: "starting"; sessionId: string }
  | { status: "recording"; sessionId: string }
  | { status: "finalizing"; sessionId: string }
  | { status: "transcribing"; sessionId: string }
  | {
      status: "completed";
      sessionId: string;
      outcome: DictationCompletionOutcome | "failed";
      insertionOutcome?: DictationInsertionOutcome;
      recoveryOutcome?: RecoveryInsertionTerminalOutcome;
      text: string;
      message: string;
      detectedLanguage?: string | null;
    }
  | {
      status: "error";
      sessionId: string | null;
      message: string;
    };

// ─── Audio ───────────────────────────────────────────────────────────────────

export interface AudioClip {
  pcmData: number[];
  sampleRate: number;
  durationSeconds: number;
  rmsFrames: number[];
  /** Boost applied to pcmData after capture. Absent means no boost. */
  gain?: number;
}

/** Processing flags the capture track reports as active. Absent when the track did not report them. */
export interface CaptureTrackSettings {
  echoCancellation?: boolean;
  autoGainControl?: boolean;
  noiseSuppression?: boolean;
}

/** Clip levels before the boost applied for transcription. */
export interface CaptureLevels {
  preGainPeak: number;
  preGainRms: number;
  gain: number;
}

export interface AudioVisualFrame {
  level: number;
  bars: number[];
}

export type CaptureBackend = "native" | "renderer";
// "unprocessed" turns off browser echo cancellation, auto gain, and noise suppression.
export type CaptureProcessing = "default" | "unprocessed";

export interface AudioInputDevice {
  uid: string;
  name: string;
  transportType: string;
  isDefault: boolean;
  isPhysical: boolean;
}

export interface AudioQualityMetrics {
  durationSeconds: number;
  sampleRate: number;
  sampleCount: number;
  rmsAverage: number;
  rmsPeak: number;
  peakAmplitude: number;
  clippingRatio: number;
  silenceRatio: number;
}

export type TranscriptInsertionAction = "insert" | "retry" | "save" | "reject";

export interface TranscriptQualityDecision {
  action: TranscriptInsertionAction;
  reason: string;
}

export interface TranscriptionQualityMetadata {
  provider: string;
  attemptCount: number;
  supportsConfidence: boolean;
  confidence?: number | null;
  noSpeechProbability?: number | null;
  avgLogprob?: number | null;
  compressionRatio?: number | null;
  segmentCount?: number;
  transcriptLength: number;
  chunkCount?: number;
  chunkDurationsSeconds?: number[];
  chunkOverlapSeconds?: number;
  /** True when the request carried vocabulary hints. Models without hint support report false. */
  vocabularyHintsSent?: boolean;
  /** One no_speech probability per provider segment. Absent when the provider returns no segments. */
  segmentNoSpeechProbabilities?: number[];
  decision?: TranscriptQualityDecision;
}

/** "speech": clear speech contrast. "uncertain": quiet audio with no contrast, still transcribed. "silent": empty or digitally silent, rejected. */
export type SpeechGateDecision = "speech" | "uncertain" | "silent";

export interface SpeechGateTrace {
  /** False only when the clip was rejected before transcription. */
  pass: boolean;
  /** Absent on traces written before the decision existed. */
  decision?: SpeechGateDecision;
  reason: string;
  noiseFloor: number;
  enterThreshold: number;
  longestRunMs: number;
  totalSpeechMs: number;
}

// ─── History ─────────────────────────────────────────────────────────────────

export type DictationInsertionOutcome = "verified" | "unconfirmed" | "refused" | "copy-only" | "failed";
export type DictationTraceOutcome = DictationInsertionOutcome | "started" | "injected" | "saved" | "rejected" | "cancelled" | (string & {});
export type DictationRejectionReason = "no_speech" | "microphone_permission_denied" | "fragment" | "recorder_unavailable" | "recorder_failure" | "timeout" | "stale-session" | "transcription_error" | "insertion_failed" | "cancelled";

export interface ProviderAttemptTrace {
  provider: string;
  success: boolean;
  attempt?: number;
  latencyMs?: number;
  error?: string;
  outcome?: "succeeded" | "failed" | "cancelled";
  errorClass?: import("./recovery").RecoveryErrorClass;
  startedAt?: string;
  completedAt?: string;
  deadlineAt?: string | null;
  quality?: TranscriptionQualityMetadata;
  /** Model the attempt asked for. */
  model?: string;
  /** Why this provider ran after an earlier one failed or was skipped. */
  fallbackReason?: string;
}

export interface InjectionAttemptTrace {
  targetAppBundleId: string | null;
  targetAppName: string | null;
  targetFieldClass?: string | null;
  method?: InjectionMethod | null;
  success: boolean;
  fallbackReason?: string;
  verification?: InsertionVerificationTrace;
}

export interface InsertionVerificationTrace {
  readable: boolean;
  passed: boolean;
  repaired: boolean;
  reason?: "expected-present" | "baseline-unreadable" | "unreadable" | "timeout" | "partial-suffix-repaired" | "partial-unsafe" | "missing" | "not-at-target";
}

export type DictationFormatterUsed = "llm" | "guard-fallback" | "deterministic" | "none";
export type DictationFormatterStatus = "ran" | "skipped" | "failed" | "rejected";

export interface DictationCorrectionTrace {
  spoken: string;
  written: string;
}

export interface DictationStageQualityDecision {
  action: TranscriptInsertionAction;
  reason: string;
  confidence?: number | null;
  noSpeechProbability?: number | null;
  attemptCount: number;
}

export interface DictationContentGuardVerdict {
  passed: boolean;
  missingWords?: string[];
}

export interface DictationStageSnapshot {
  rawTranscript?: string;
  qualityDecision?: DictationStageQualityDecision;
  cleanedText?: string;
  formatterUsed?: DictationFormatterUsed;
  formatterStatus?: DictationFormatterStatus;
  formatterStatusReason?: string;
  formatterReason?: "timeout";
  staleStage?: "starting" | "recording" | "finalizing" | "transcribing";
  contentGuardVerdict?: DictationContentGuardVerdict;
  correctionsApplied?: DictationCorrectionTrace[];
  injectedText?: string;
  injectionStrategy?: InjectionMethod | "none";
  insertionVerification?: InsertionVerificationTrace;
  outcome?: DictationTraceOutcome;
}

export interface DictationTrace {
  id: string;
  sessionId: string;
  startedAt: string;
  buildIdentifier?: string;
  completedAt?: string;
  hotkeyReleasedAt?: string;
  stopRequestedAt?: string;
  lastFrameAfterStopMs?: number;
  trailingRms?: number;
  clipReadyAt?: string;
  sttDoneAt?: string;
  formatDoneAt?: string;
  dispatchAt?: string;
  verifyDoneAt?: string;
  targetAppBundleId: string | null;
  targetAppName: string | null;
  /** Levels of the gain-adjusted clip sent for transcription. */
  rawAudio?: AudioQualityMetrics;
  /** Peak and RMS before gain, and the gain applied. */
  captureLevels?: CaptureLevels;
  /** Processing the mic track actually reported. */
  captureSettings?: CaptureTrackSettings;
  speechGate?: SpeechGateTrace;
  trimmedAudio?: AudioQualityMetrics;
  rawAudioPath?: string | null;
  sttProvider?: string | null;
  sttLatencyMs?: number;
  formattingLatencyMs?: number;
  transcriptLength?: number;
  quality?: TranscriptionQualityMetadata;
  qualityDecision?: TranscriptQualityDecision;
  providerAttempts?: ProviderAttemptTrace[];
  injectionAttempts?: InjectionAttemptTrace[];
  injectionMethod?: InjectionMethod | null;
  stages?: DictationStageSnapshot;
  outcome: DictationTraceOutcome;
  rejectionReason?: DictationRejectionReason;
  userMessage?: string;
}

export interface DictationBugReport {
  entry: Pick<DictationEntry,
    | "id"
    | "traceId"
    | "timestamp"
    | "durationSeconds"
    | "injectionStatus"
    | "injectionMethod"
    | "language"
    | "detectedLanguage"
  > | null;
  trace: (Pick<DictationTrace,
    | "id"
    | "sessionId"
    | "startedAt"
    | "buildIdentifier"
    | "completedAt"
    | "hotkeyReleasedAt"
    | "sttProvider"
    | "sttLatencyMs"
    | "formattingLatencyMs"
    | "transcriptLength"
    | "injectionMethod"
    | "outcome"
    | "rejectionReason"
  > & {
    rawAudio?: AudioQualityMetrics;
    trimmedAudio?: AudioQualityMetrics;
    quality?: Omit<TranscriptionQualityMetadata, "decision"> & {
      decision?: Pick<TranscriptQualityDecision, "action">;
    };
    qualityDecision?: Pick<TranscriptQualityDecision, "action">;
    providerAttempts?: Array<Pick<ProviderAttemptTrace,
      | "provider"
      | "success"
      | "attempt"
      | "latencyMs"
      | "outcome"
      | "errorClass"
      | "startedAt"
      | "completedAt"
      | "deadlineAt"
    > & {
      quality?: Omit<TranscriptionQualityMetadata, "decision"> & {
        decision?: Pick<TranscriptQualityDecision, "action">;
      };
    }>;
    injectionAttempts?: Array<Pick<InjectionAttemptTrace, "method" | "success"> & {
      verification?: InsertionVerificationTrace;
    }>;
    stages?: Pick<DictationStageSnapshot,
      | "formatterUsed"
      | "injectionStrategy"
      | "outcome"
    > & {
      qualityDecision?: Omit<DictationStageQualityDecision, "reason">;
      contentGuardVerdict?: Pick<DictationContentGuardVerdict, "passed">;
      insertionVerification?: InsertionVerificationTrace;
    };
  }) | null;
  generatedAt: string;
  appVersion?: string;
}

export interface DictationEntry {
  id: string;
  traceId?: string | null;
  timestamp: string;
  rawText: string;
  formattedText: string;
  cleanedText: string;
  durationSeconds: number;
  appBundleId: string | null;
  appName: string | null;
  injectionStatus: DictationCompletionOutcome;
  injectionMethod: InjectionMethod | null;
  language: string | null;
  /** Provider-detected language when auto-detect is used. */
  detectedLanguage?: string | null;
  rawAudioPath?: string | null;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface CustomCorrection {
  spoken: string;
  written: string;
  source?: "auto-suggested" | "manual";
  enabled?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  fuzzy?: boolean;
  hitCount?: number;
  lastUsedAt?: string;
}

export interface Snippet {
  trigger: string;
  content: string;
  matchBareTrigger?: boolean;
  appProfileIds?: string[];
}

export interface AppProfile {
  id: string;
  name: string;
  appBundleIds: string[];
  transcriptionProvider?: string;
  formattingProvider?: string;
  language?: string;
  stylePreset?: Settings["stylePreset"];
  contextAwarenessEnabled?: boolean;
  autoSubmit?: boolean;
  customPrompt?: string;
}

export interface ProviderApiKey {
  providerId: string;
  key: string;
  hasKey?: boolean;
  lastValidation?: ProviderKeyValidation | null;
}

export interface ProviderKeyValidation {
  valid: boolean;
  message: string;
  testedAt: string;
}

export interface Settings {
  onboardingCompleted: boolean;
  groqApiKey: string;
  primaryHotkey: string;
  pasteLatestHotkey: string;
  language: string;
  customPrompt?: string;
  cleanupEnabled: boolean;
  smartPunctuation: boolean;
  fillerWords: string[];
  fillerWordsCustomized?: boolean;
  extraFillerWords: string[];
  customCorrections: CustomCorrection[];
  snippets: Snippet[];
  injectionMode: "auto" | "ax" | "clipboard";
  pasteMode: "instant" | "animated";
  theme: "aurora";
  colorMode: "light" | "dark";
  accentColor: string;
  launchAtLogin: boolean;
  showInDock: boolean;
  minClipDuration: number;
  silenceThreshold: number;
  capsuleBorderWidth: number;
  capsuleBarRadius: number;
  capsuleCornerRadius: number;
  capsuleDesign: "dot" | "bar" | "rule" | "pill";
  // Phase 0: New settings
  dictationMode: DictationMode;
  saveRecordings: boolean;
  recordingsPath: string;
  recoveryRetentionDays: 1 | 3 | 7 | 14;
  retainFailedAudio: boolean;
  // Phase 1: Provider settings
  transcriptionProvider: string;
  transcriptionModel: string;
  formattingProvider: string;
  formattingModel: string;
  providerApiKeys: ProviderApiKey[];
  failoverEnabled: boolean;
  /** Set once the user has seen the OpenRouter key prompt, so it is not shown again. */
  openRouterKeyPromptShown: boolean;
  // Phase 2: Local model settings
  localWhisperModel: string;
  offlineMode: "auto" | "always-offline" | "always-online";
  contextAwarenessEnabled: boolean;
  micDeviceId?: string;
  preWarmMic: boolean;
  captureBackend: CaptureBackend;
  captureProcessing: CaptureProcessing;
  stylePreset: "plain" | "developer" | "casual" | "formal" | "email";
  // Onboarding tracking
  dictionaryOnboarded: boolean;
  snippetsOnboarded: boolean;
  setupChecklistDismissed: boolean;
  // Per-app language/provider overrides
  appProfiles?: AppProfile[];
}

export type MacOSPermissionState = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

export interface PermissionStatus {
  microphone: MacOSPermissionState;
  accessibility: MacOSPermissionState;
}

// ─── Transcription ───────────────────────────────────────────────────────────

export interface TranscriptionResult {
  rawText: string;
  formattedText: string;
  language: string | null;
  /** Provider-detected language (from verbose_json / Deepgram response). Null when unknown. */
  detectedLanguage?: string | null;
  quality?: TranscriptionQualityMetadata;
  providerAttempts?: ProviderAttemptTrace[];
}

export interface TranscriptionOptions {
  model?: string;
  language?: string;
  prompt?: string;
  /** Dictionary terms to send as vocabulary hints. Providers decide whether their model takes them. */
  vocabularyHints?: string[];
  temperature?: number;
  streaming?: boolean;
  signal?: AbortSignal;
  recovery?: boolean;
}

export interface FormattingOptions {
  model?: string;
  style?: "default" | "strict" | "casual";
  systemPrompt?: string;
  signal?: AbortSignal;
}

export type InjectionResult =
  | { success: true; method: InjectionMethod }
  | { success: false; reason: InjectionFailureReason };

export interface RecorderSubmission {
  sessionId: string;
  clip: AudioClip;
  tailMetrics?: { lastFrameAfterStopMs: number; trailingRms: number };
  captureSettings?: CaptureTrackSettings;
}

export interface RecorderFailure {
  sessionId: string;
  message: string;
  kind?: "interrupted" | "microphone_permission_denied" | "recorder_failure";
  partialClip?: AudioClip;
}

export interface RecorderSuspensionAck {
  sessionId: string;
  ok: boolean;
  partialClip?: AudioClip;
  message?: string;
}

export interface RecorderConfig {
  micDeviceId?: string;
  preWarmMic: boolean;
  captureBackend?: CaptureBackend;
  captureProcessing?: CaptureProcessing;
}

export interface RecorderCommand {
  sessionId: string;
  config: RecorderConfig;
}

// ─── IPC API types ───────────────────────────────────────────────────────────

export type UpdateStatus = "checking" | "available" | "downloading" | "ready" | "no-update" | "error";

export interface UpdateNotificationPayload {
  version?: string;
  status: UpdateStatus;
  message: string;
  installable?: boolean;
}

export interface VaaniAPI {
  getDictationState: () => Promise<DictationState>;
  onStateChange: (cb: (state: DictationState) => void) => () => void;
  onAudioLevel: (cb: (level: number, bars?: number[]) => void) => () => void;
  getHistory: () => Promise<DictationEntry[]>;
  updateHistoryEntry: (id: string, cleanedText: string) => Promise<DictationEntry | undefined>;
  deleteEntry: (id: string) => Promise<void>;
  reinjectEntry: (id: string) => Promise<void>;
  retryHistoryEntry: (id: string) => Promise<void>;
  getRecoveryReadiness: () => Promise<RecoveryReadiness>;
  getRecoveryEntries: () => Promise<RecoveryEntryView[]>;
  retryRecoveryTranscription: (id: string) => Promise<boolean>;
  retryRecoveryFormatting: (id: string) => Promise<boolean>;
  useRawRecoveryTranscript: (id: string) => Promise<boolean>;
  retryRecoveryInsertion: (id: string) => Promise<boolean>;
  copyRecoveryEntry: (id: string) => Promise<boolean>;
  playRecoveryAudio: (id: string) => Promise<boolean>;
  deleteRecoveryAudio: (id: string) => Promise<boolean>;
  discardRecoveryEntry: (id: string) => Promise<boolean>;
  getRecoveryStorageUsage: () => Promise<RecoveryStorageUsage>;
  cleanupRecoveryAudio: () => Promise<RecoveryStorageUsage>;
  clearRecoveryAudio: () => Promise<RecoveryStorageUsage>;
  getRecoveryRestoredNotice: () => Promise<RecoveryRestoredNotice | null>;
  getDictationTrace: (traceId: string) => Promise<DictationTrace | undefined>;
  exportBugReport: (entryId: string) => Promise<DictationBugReport>;
  clearHistory: () => Promise<void>;
  copyText: (text: string) => Promise<boolean>;
  getSettings: () => Promise<Settings>;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  setHotkeyCapture: (active: boolean) => Promise<void>;
  showDictionaryPrompt: (suggestions: DictionarySuggestion[]) => Promise<void>;
  purgeAutoSuggestedCorrections: () => Promise<Settings>;
  getPermissionStatus: () => Promise<PermissionStatus>;
  listAudioInputDevices: () => Promise<AudioInputDevice[]>;
  requestMicrophonePermission: () => Promise<MacOSPermissionState>;
  requestAccessibilityPermission: () => Promise<MacOSPermissionState>;
  openPermissionSettings: (permission: keyof PermissionStatus) => Promise<void>;
  onPermissionStatusChanged: (cb: (status: PermissionStatus) => void) => () => void;
  relaunchApp: () => Promise<void>;
  onNavigate: (cb: (route: string) => void) => () => void;
  onUpdateNotification: (cb: (payload: UpdateNotificationPayload) => void) => () => void;
  getUpdateStatus: () => Promise<UpdateNotificationPayload | null>;
  checkForUpdates: () => Promise<{ available: boolean; version: string }>;
  quitAndInstall: () => void;
  restartAndInstall: () => Promise<void>;
  openReleasesPage: () => void;
  getAppVersion: () => Promise<string>;
  reportRendererReady: () => void;
  reportRendererError: (payload: { message: string; stack?: string }) => void;
  testApiKey: (providerId: string, apiKey: string) => Promise<{ valid: boolean; message: string }>;
  setProviderApiKey: (providerId: string, apiKey: string) => Promise<Settings>;
  clearProviderApiKey: (providerId: string) => Promise<Settings>;
  getProviderStatus: () => Promise<{ id: string; name: string; available: boolean; configured: boolean; type: string }[]>;
  whisperListModels: () => Promise<string[]>;
  whisperLoadModel: (modelName: string) => Promise<boolean>;
  whisperFreeModel: () => Promise<void>;
  whisperIsModelLoaded: () => Promise<boolean>;
  demoTranscribe: (clip: AudioClip) => Promise<string>;
}

declare global {
  interface Window {
    vaani: VaaniAPI;
    __VAANI_RECORDER__: {
      onStartRecording: (cb: (payload: RecorderCommand) => void) => () => void;
      onStopRecording: (cb: (payload: RecorderCommand) => void) => () => void;
      onAbortRecording: (cb: (payload: RecorderCommand) => void) => () => void;
      onSuspendRecording: (cb: (payload: RecorderCommand) => void) => () => void;
      onResumeRecording: (cb: (payload: RecorderCommand) => void) => () => void;
      submitAudioClip: (payload: RecorderSubmission) => Promise<void>;
      reportRecorderReady: () => Promise<void>;
      reportRecorderStarted: (sessionId: string) => Promise<void>;
      reportAudioFrame: (frame: AudioVisualFrame) => Promise<void>;
      reportRecorderFailure: (payload: RecorderFailure) => Promise<void>;
      reportRecorderSuspended: (payload: RecorderSuspensionAck) => Promise<void>;
      prepareRecordingInput: () => Promise<number | null>;
      restoreRecordingInput: (deviceId: number | null) => Promise<boolean>;
      getRecorderConfig: () => Promise<RecorderConfig>;
      listAudioInputDevices: () => Promise<AudioInputDevice[]>;
      requestMicrophonePermission: () => Promise<MacOSPermissionState>;
      onRecorderConfigChanged: (cb: (payload: RecorderConfig) => void) => () => void;
    };
  }
}
