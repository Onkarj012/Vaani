import type { DictionarySuggestion } from "./dictionarySuggestions";

// ─── Dictation State ─────────────────────────────────────────────────────────

export type DictationStatus = "idle" | "starting" | "recording" | "finalizing" | "transcribing" | "completed" | "error";
export type DictationCompletionOutcome = "injected" | "saved";
export type InjectionMethod = "ax" | "clipboard";
export type InjectionFailureReason = "permission_missing" | "no_editable_target" | "insertion_failed" | "activation_failed";
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
      outcome: DictationCompletionOutcome;
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
}

export interface AudioVisualFrame {
  level: number;
  bars: number[];
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
  decision?: TranscriptQualityDecision;
}

// ─── History ─────────────────────────────────────────────────────────────────

export type DictationTraceOutcome = "started" | "injected" | "saved" | "rejected" | "failed" | "cancelled";
export type DictationRejectionReason = "no_speech" | "fragment" | "recorder_unavailable" | "recorder_failure" | "timeout" | "transcription_error" | "insertion_failed" | "cancelled";

export interface ProviderAttemptTrace {
  provider: string;
  success: boolean;
  latencyMs?: number;
  error?: string;
  quality?: TranscriptionQualityMetadata;
}

export interface InjectionAttemptTrace {
  targetAppBundleId: string | null;
  targetAppName: string | null;
  method?: InjectionMethod | null;
  success: boolean;
  fallbackReason?: string;
}

export type DictationFormatterUsed = "llm" | "guard-fallback" | "deterministic" | "none";

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
  contentGuardVerdict?: DictationContentGuardVerdict;
  correctionsApplied?: DictationCorrectionTrace[];
  injectedText?: string;
  injectionStrategy?: InjectionMethod | "none";
  outcome?: DictationTraceOutcome;
}

export interface DictationTrace {
  id: string;
  sessionId: string;
  startedAt: string;
  completedAt?: string;
  hotkeyReleasedAt?: string;
  targetAppBundleId: string | null;
  targetAppName: string | null;
  rawAudio?: AudioQualityMetrics;
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
  entry: DictationEntry | null;
  trace: DictationTrace | null;
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
}

export interface Snippet {
  trigger: string;
  content: string;
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
  // Phase 1: Provider settings
  transcriptionProvider: string;
  formattingProvider: string;
  formattingModel: string;
  providerApiKeys: ProviderApiKey[];
  failoverEnabled: boolean;
  // Phase 2: Local model settings
  localWhisperModel: string;
  offlineMode: "auto" | "always-offline" | "always-online";
  contextAwarenessEnabled: boolean;
  micDeviceId?: string;
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
  temperature?: number;
  streaming?: boolean;
}

export interface FormattingOptions {
  model?: string;
  style?: "default" | "strict" | "casual";
  systemPrompt?: string;
}

export type InjectionResult =
  | { success: true; method: InjectionMethod }
  | { success: false; reason: InjectionFailureReason };

export interface RecorderSubmission {
  sessionId: string;
  clip: AudioClip;
}

export interface RecorderFailure {
  sessionId: string;
  message: string;
}

export interface RecorderCommand {
  sessionId: string;
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
      submitAudioClip: (payload: RecorderSubmission) => Promise<void>;
      reportRecorderReady: () => Promise<void>;
      reportRecorderStarted: (sessionId: string) => Promise<void>;
      reportAudioFrame: (frame: AudioVisualFrame) => Promise<void>;
      reportRecorderFailure: (payload: RecorderFailure) => Promise<void>;
      prepareRecordingInput: () => Promise<number | null>;
      restoreRecordingInput: (deviceId: number | null) => Promise<boolean>;
    };
  }
}
