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

// ─── History ─────────────────────────────────────────────────────────────────

export interface DictationEntry {
  id: string;
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
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface CustomCorrection {
  spoken: string;
  written: string;
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
  autoSubmit?: boolean;
  customPrompt?: string;
}

export interface ProviderApiKey {
  providerId: string;
  key: string;
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
  // Onboarding tracking
  dictionaryOnboarded: boolean;
  snippetsOnboarded: boolean;
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

export type UpdateStatus = "checking" | "downloading" | "ready" | "no-update" | "error";

export interface UpdateNotificationPayload {
  version?: string;
  status: UpdateStatus;
  message: string;
}

export interface VaaniAPI {
  getDictationState: () => Promise<DictationState>;
  onStateChange: (cb: (state: DictationState) => void) => () => void;
  onAudioLevel: (cb: (level: number, bars?: number[]) => void) => () => void;
  getHistory: () => Promise<DictationEntry[]>;
  updateHistoryEntry: (id: string, cleanedText: string) => Promise<DictationEntry | undefined>;
  deleteEntry: (id: string) => Promise<void>;
  reinjectEntry: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  copyText: (text: string) => Promise<boolean>;
  getSettings: () => Promise<Settings>;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  setHotkeyCapture: (active: boolean) => Promise<void>;
  showDictionaryPrompt: (suggestions: DictionarySuggestion[]) => Promise<void>;
  getPermissionStatus: () => Promise<PermissionStatus>;
  requestMicrophonePermission: () => Promise<MacOSPermissionState>;
  requestAccessibilityPermission: () => Promise<MacOSPermissionState>;
  openPermissionSettings: (permission: keyof PermissionStatus) => Promise<void>;
  relaunchApp: () => Promise<void>;
  onNavigate: (cb: (route: string) => void) => () => void;
  onUpdateNotification: (cb: (payload: UpdateNotificationPayload) => void) => () => void;
  getUpdateStatus: () => Promise<UpdateNotificationPayload | null>;
  checkForUpdates: () => Promise<{ available: boolean; version: string }>;
  quitAndInstall: () => void;
  restartAndInstall: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  reportRendererReady: () => void;
  reportRendererError: (payload: { message: string; stack?: string }) => void;
  testApiKey: (providerId: string, apiKey: string) => Promise<{ valid: boolean; message: string }>;
  getProviderStatus: () => Promise<{ id: string; name: string; available: boolean; configured: boolean }[]>;
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
