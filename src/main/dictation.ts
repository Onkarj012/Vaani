import { captureSessionSettings, restoreSessionSettings, type SessionSettingsSnapshot } from "@shared/sessionSettings";
import * as electron from "electron";
import { createHash } from "node:crypto";
import { writeFile, mkdir, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import type { DictionarySuggestion } from "@shared/dictionarySuggestions";
import type { BrowserWindow } from "electron";
import type {
  AudioClip,
  AudioQualityMetrics,
  AudioVisualFrame,
  DictationCompletionOutcome,
  DictationEntry,
  DictationInsertionOutcome,
  DictationRejectionReason,
  DictationState,
  DictationTrace,
  DictationBugReport,
  InsertionVerificationTrace,
  InjectionFailureReason,
  ProviderAttemptTrace,
  RecorderFailure,
  RecorderSubmission,
  SelectionRange,
  Settings,
  TranscriptionResult
} from "@shared/types";
import { ERROR_RESET_MS, SUCCESS_RESET_MS } from "@shared/defaults";
import { resolveSessionModels } from "@shared/modelList";
import { IpcChannel } from "@shared/ipc";
import { trimSilence, isValidClip } from "./audio/vad";
import { evaluateSpeechGate } from "./audio/speechGate";
import { AppDetector, type AppContextResult } from "./context/appDetector";
import { TextInjector } from "./injection";
import { cancelPendingClipboardRestore } from "./injection/clipboard";
import { nativeBridge } from "./nativeBridge";
import { debug } from "@main/log";
import { OverlayController } from "./overlay";
import { HistoryStore } from "./store/history";
import { DictationTraceStore } from "./store/dictationTrace";
import { SettingsStore } from "./store/settings";
import { CredentialsStore } from "./store/credentials";
import { applyDictionary, cleanupText, hasSpokenContent } from "./text/cleanup";
import { detectDictionarySuggestions, isAutoLearnableDictionarySuggestion, isValidDictionarySuggestion } from "@shared/dictionarySuggestions";
import { getTranscriptionTimeoutMs, TranscriptionCancelledError, TranscriptionDeadlineExceededError, TranscriptionChainError, TranscriptionService, type FormatTranscriptTraceResult } from "./transcription";
import { SessionTimers } from "./dictation/sessionTimers";
import { decideTranscriptInsertion, finalizeTranscriptDecision } from "./transcriptQuality";
import { mergeDictationTracePatch } from "./dictationTraceSnapshot";
import { formatBuildIdentifier } from "@shared/buildIdentifier";
import { evaluateInsertionAcceptance } from "@shared/insertionAcceptance";
import { resolveProfileLanguage } from "@main/providers/language";
import { createRecoveryEntry, type RecoveryEntry, type RecoveryState, type RecoveryErrorClass, type RecoveryInsertionPreparation, type RecoveryInsertionTerminalOutcome, type RecoveryTextReferences } from "@shared/recovery";
import type { RecoveryJournalStore } from "./store/recoveryJournal";
import type { EncryptedRecoveryAudioStore } from "./audio/recoveryAudio";
import { isRecoveryEnabled } from "./recoveryReadiness";
import { intendedInjectionStrategy } from "./injection/policy";
import { createDictationBugReport } from "./dictationBugReport";

const FINALIZATION_TIMEOUT_MS = 4_000;
const FORMATTING_TIMEOUT_MS = 20_000;
const AUDIO_FRAME_TIMEOUT_MS = 1_600;
const RECORDER_START_TIMEOUT_MS = 5_000;
const STALE_SESSION_TIMEOUT_MS = 60_000;
const UPTIME_LOG_INTERVAL_MS = 3_600_000;
const EDIT_WATCH_INTERVAL_MS = 500;
const EDIT_WATCH_TIMEOUT_MS = 60_000;
const EDIT_PROMPT_IDLE_MS = 1_000;
const INSERTION_VERIFY_POLL_INTERVAL_MS = 50;
const INSERTION_VERIFY_TIMEOUT_MS = 2_000;
const TRANSCRIPTION_TIMEOUT_MESSAGE = "Transcription timed out. Please try again.";
type ElectronModule = typeof import("electron") & { default?: typeof import("electron") };
const electronModule = electron as unknown as ElectronModule;

function getDefaultMicrophonePermission(): string {
  return electron.systemPreferences.getMediaAccessStatus("microphone");
}

interface RecorderCommands {
  isReady: () => boolean;
  startRecording: (sessionId: string) => boolean;
  stopRecording: (sessionId: string) => boolean;
  abortRecording?: (sessionId: string) => void;
}

type DictationTraceDeps = Pick<DictationTraceStore, "upsert" | "updateById" | "getById" | "getBySessionId">
  & Partial<Pick<DictationTraceStore, "getAll">>;

interface DictationServiceDeps {
  transcription?: Pick<TranscriptionService, "transcribe" | "formatTranscript"> & Partial<Pick<TranscriptionService, "formatTranscriptDetailed">>;
  injector?: Pick<TextInjector, "inject">;
  appDetector?: Pick<AppDetector, "getContext">;
  getMicrophonePermission?: () => string;
  recorder?: RecorderCommands;
  credentials?: CredentialsStore;
  createSessionId?: () => string;
  traces?: DictationTraceDeps;
  recovery?: Pick<RecoveryJournalStore, "create" | "getById" | "transition"> & Partial<Pick<RecoveryJournalStore, "updateRecoveryMode" | "markRouteHandoff" | "prepareInsertion" | "recordInsertionOutcome" | "updateText">>;
  recoveryAudio?: Pick<EncryptedRecoveryAudioStore, "spool" | "deleteForSession" | "withDecryptedAudio">;
  copyText?: (text: string) => Promise<boolean> | boolean;
  recoveryReady?: () => boolean;
  verifierNow?: () => number;
  verifierSleep?: (ms: number) => Promise<void>;
}

export class DictationService {
  private state: DictationState = { status: "idle" };
  private readonly transcription: Pick<TranscriptionService, "transcribe" | "formatTranscript"> & Partial<Pick<TranscriptionService, "formatTranscriptDetailed">>;
  private readonly injector: Pick<TextInjector, "inject">;
  private readonly appDetector: Pick<AppDetector, "getContext">;
  private readonly getMicrophonePermission: () => string;
  private readonly createSessionId: () => string;
  private readonly traces: DictationTraceDeps | null;
  private readonly verifierNow: () => number;
  private readonly verifierSleep: (ms: number) => Promise<void>;
  private readonly recovery: DictationServiceDeps["recovery"];
  private readonly recoveryAudio: DictationServiceDeps["recoveryAudio"];
  private readonly recoveryRetentionPromises = new Set<Promise<void>>();
  private readonly recoveryReady: () => boolean;
  private readonly copyText: (text: string) => Promise<boolean>;
  private recoveryMutation: Promise<void> = Promise.resolve();
  private recoveryEntryReady: Promise<void> = Promise.resolve();
  private readonly timers = new SessionTimers();
  private pendingEditPromptKey: string | null = null;
  private pendingEdit: { insertedText: string; correctedCandidate: string } | null = null;
  private dictionaryPromptGeneration = 0;
  private activeSessionId: string | null = null;
  private activeSessionSettings: SessionSettingsSnapshot | null = null;
  private activeTraceId: string | null = null;
  private activeTarget: AppContextResult | null = null;
  private activeSelection: SelectionRange | null = null;
  private activeTargetValue: string | null = null;
  private activeTargetIdentity: string | null = null;
  private releaseRequestedDuringStart = false;
  private pendingStopRequestedAt: string | null = null;
  private readonly recorder: RecorderCommands | null;
  private pasteLatestInProgress = false;
  private sessionAbortController: AbortController | null = null;
  private readonly recoveryActionAbortControllers = new Set<AbortController>();
  private sessionGeneration = 0;
  private readonly recordedInsertionOutcomes = new Set<string>();
  private readonly manualRetriesInProgress = new Set<string>();
  private readonly cancelledRecoveryRetryIds = new Set<string>();
  private activeInsertionPrepared = false;
  private activeInsertionDispatched = false;
  private activePreparedEntry: DictationEntry | null = null;
  private readonly historyWrites = new Map<string, Promise<boolean>>();
  private readonly terminalTraceSessions = new Set<string>();

  constructor(
    private readonly mainWindow: BrowserWindow | null,
    private readonly settings: SettingsStore,
    private readonly history: HistoryStore,
    private readonly updateTrayStatus: (label: string) => void,
    private readonly overlay: OverlayController,
    deps: DictationServiceDeps = {}
  ) {
    this.transcription = deps.transcription ?? new TranscriptionService(() => this.settings.get(), deps.credentials);
    this.injector = deps.injector ?? new TextInjector(() => this.activeSessionSettings ? restoreSessionSettings(this.activeSessionSettings) : this.settings.get());
    this.appDetector = deps.appDetector ?? new AppDetector();
    this.getMicrophonePermission = deps.getMicrophonePermission ?? getDefaultMicrophonePermission;
    this.recorder = deps.recorder ?? null;
    this.createSessionId = deps.createSessionId ?? (() => crypto.randomUUID());
    this.traces = deps.traces ?? null;
    this.recovery = deps.recovery;
    this.recoveryAudio = deps.recoveryAudio;
    this.recoveryReady = deps.recoveryReady ?? isRecoveryEnabled;
    this.copyText = async (text) => {
      if (deps.copyText) return deps.copyText(text);
      try {
        cancelPendingClipboardRestore();
        electron.clipboard.writeText(text);
        return electron.clipboard.readText() === text;
      } catch {
        return false;
      }
    };
    this.verifierNow = deps.verifierNow ?? (() => performance.now());
    this.verifierSleep = deps.verifierSleep ?? delay;
    this.startUptimeLogging();
  }

  private startUptimeLogging(): void {
    this.timers.setInterval("uptimeLog", () => {
      const uptimeHrs = Math.round(process.uptime() / 3600);
      debug("dictation", `uptime checkpoint: ${uptimeHrs}h, state=${this.state.status}, session=${this.activeSessionId ?? "none"}`);
    }, UPTIME_LOG_INTERVAL_MS);
  }

  private armStaleSessionGuard(sessionId: string): void {
    this.clearStaleSessionTimer();
    this.timers.setTimeout("staleSession", () => {
      const stage = this.state.status;
      if (this.isCurrentSession(sessionId) && (stage === "starting" || stage === "recording" || stage === "finalizing" || stage === "transcribing")) {
        debug("dictation", `stale session guard fired: status=${stage}, ending session`);
        this.sessionAbortController?.abort("stale-session");
        this.recorder?.abortRecording?.(sessionId);
        if (this.activeInsertionDispatched && this.activePreparedEntry) {
          void this.settleInterruptedInsertion(sessionId);
          this.resetToIdle();
        } else {
          this.failSession(sessionId, `Dictation stopped while ${stage}. Please try again.`, "stale-session", [], undefined, undefined, { stages: { staleStage: stage } });
        }
      }
    }, STALE_SESSION_TIMEOUT_MS);
  }

  private rearmStaleSessionGuard(): void {
    if (this.activeSessionId) {
      this.armStaleSessionGuard(this.activeSessionId);
    }
  }

  beginHotkeySession(): void {
    this.cancelRecoveryActions("new-dictation");
    this.cancelledRecoveryRetryIds.clear();
    if (this.state.status !== "idle") {
      if (this.state.status === "completed" || this.state.status === "error") {
        this.resetToIdle();
      } else if (this.state.status === "transcribing") {
        this.sessionAbortController?.abort("new-dictation");
        if (this.activeSessionId) {
          if (this.activeInsertionDispatched && this.activePreparedEntry) void this.settleInterruptedInsertion(this.activeSessionId);
          else {
            const outcome: DictationInsertionOutcome = this.activeInsertionPrepared ? "refused" : "failed";
            void this.finishTrace(this.activeSessionId, outcome, "cancelled", insertionStatusText(outcome, false, "processing"));
          }
        }
        this.resetToIdle();
      } else {
        return;
      }
    }

    this.clearTimers();

    this.cancelDictionaryPrompts("new-dictation");
    this.discardPendingEdit("new-dictation");
    this.clearEditWatch();

    const sessionId = this.createSessionId();
    this.sessionGeneration += 1;
    this.sessionAbortController = new AbortController();
    this.activeSessionId = sessionId;
    this.activeTarget = this.appDetector.getContext();
    const settings = this.settings.get();
    const profile = resolveAppProfile(settings.appProfiles ?? [], this.activeTarget?.appBundleId);
    this.activeSessionSettings = captureSessionSettings({
      ...settings,
      ...resolveSessionModels(settings, profile),
      language: resolveProfileLanguage(profile?.language, settings.language),
      customPrompt: profile?.customPrompt ?? settings.customPrompt,
    });
    this.activeSelection = this.captureSelection(this.activeTarget);
    this.activeTargetValue = isExternalTarget(this.activeTarget) ? safeFocusedValue() : null;
    this.activeTargetIdentity = isExternalTarget(this.activeTarget) ? safeFocusedElementIdentity() : null;
    this.recoveryEntryReady = this.startRecoveryEntry(sessionId).catch((error) => {
      debug("recovery", "entry creation failed", { sessionId, message: error instanceof Error ? error.message : String(error) });
    });
    void this.startTrace(sessionId);
    this.releaseRequestedDuringStart = false;
    this.pendingStopRequestedAt = null;
    this.setState({ status: "starting", sessionId });
    this.armStaleSessionGuard(sessionId);

    if (!this.recorder) {
      this.failSession(sessionId, "Recorder is not ready yet. Please try again in a moment.", "recorder_unavailable");
      return;
    }

    this.clearRecorderStartTimer();
    this.timers.setTimeout("recorderStart", () => {
      if (this.isCurrentSession(sessionId) && this.state.status === "starting") {
        this.failSession(sessionId, "Recorder is not ready yet. Please try again in a moment.", "recorder_unavailable");
      }
    }, RECORDER_START_TIMEOUT_MS);

    const started = this.recorder.startRecording(sessionId);
    if (!started) {
      this.failSession(sessionId, "Recorder is not ready yet. Please try again in a moment.", "recorder_unavailable");
    }
  }

  cancelSession(): void {
    this.cancelRecoveryActions("user-cancelled");
    const inFlight = this.state.status === "starting" || this.state.status === "recording"
      || this.state.status === "finalizing" || this.state.status === "transcribing";
    if (!inFlight) { this.resetToIdle(); return; }
    if (this.activeSessionId) this.recorder?.abortRecording?.(this.activeSessionId);
    this.sessionAbortController?.abort("user-cancelled");
    if (this.activeSessionId) {
      const sessionId = this.activeSessionId;
      if (this.activeInsertionDispatched && this.activePreparedEntry) void this.settleInterruptedInsertion(sessionId);
      else if (this.activeInsertionPrepared && this.state.status === "transcribing") {
        void this.recordRecoveryInsertionOutcome(sessionId, "recoverable", null, "interrupted", this.activeInsertionDispatched ? OUTCOME_UNCERTAIN_DETAIL : "cancelled").catch((error) => {
          debug("recovery", "cancelled insertion outcome could not be journaled", { sessionId, message: error instanceof Error ? error.message : String(error) });
        });
      } else {
        void this.transitionRecovery(sessionId, "recoverable", { error: { class: "interrupted", detail: "Dictation cancelled." } });
      }
      if (!this.activeInsertionDispatched || !this.activePreparedEntry) {
        const outcome: DictationInsertionOutcome = this.activeInsertionPrepared ? "refused" : "failed";
        void this.finishTrace(sessionId, outcome, "cancelled", insertionStatusText(outcome, false, "recording"));
      }
    }
    this.clearEditWatch();
    this.resetToIdle();
  }

  endHotkeySession(): void {
    if (this.state.status === "starting") {
      this.releaseRequestedDuringStart = true;
      this.pendingStopRequestedAt ??= new Date().toISOString();
      void this.patchTrace(this.state.sessionId, {
        stopRequestedAt: this.pendingStopRequestedAt,
        hotkeyReleasedAt: this.pendingStopRequestedAt,
      });
      return;
    }

    if (this.state.status !== "recording") {
      return;
    }

    const { sessionId } = this.state;
    const stopRequestedAt = this.pendingStopRequestedAt ?? new Date().toISOString();
    this.pendingStopRequestedAt = null;
    void this.patchTrace(sessionId, { stopRequestedAt, hotkeyReleasedAt: stopRequestedAt });
    void this.transitionRecovery(sessionId, "interrupted_recording", { error: { class: "interrupted", detail: "Recording finalized." } });
    this.setState({ status: "finalizing", sessionId });
    this.clearFinalizationTimer();
    this.clearAudioFrameTimer();
    if (!this.recorder?.stopRecording(sessionId)) {
      this.failSession(sessionId, "Recording could not be finalized.", "recorder_failure");
      return;
    }
    this.timers.setTimeout("finalization", () => {
      this.failSession(sessionId, "Recording did not finalize. Please try again.", "timeout");
    }, FINALIZATION_TIMEOUT_MS);
  }

  reportRecorderStarted(sessionId: string): void {
    if (!this.isCurrentSession(sessionId) || this.state.status !== "starting") {
      return;
    }

    this.clearRecorderStartTimer();
    this.setState({ status: "recording", sessionId });
    this.rearmStaleSessionGuard();
    this.clearAudioFrameTimer();
    this.timers.setTimeout("audioFrame", () => {
      if (this.isCurrentSession(sessionId) && this.state.status === "recording") {
        this.recorder?.stopRecording(sessionId);
        this.failSession(sessionId, "Microphone opened, but no live audio frames arrived.", "no_speech");
      }
    }, AUDIO_FRAME_TIMEOUT_MS);

    if (this.releaseRequestedDuringStart) {
      this.releaseRequestedDuringStart = false;
      // User released the hotkey before the mic was ready. Delay the stop so the
      // clip meets minClipDuration — otherwise the 0-length clip hits VAD rejection.
      const minRecordMs = Math.max((this.activeSessionSettings?.minClipDuration ?? this.settings.get().minClipDuration) * 1000 + 250, 750);
      setTimeout(() => {
        if (this.isCurrentSession(sessionId) && this.state.status === "recording") {
          this.endHotkeySession();
        }
      }, minRecordMs);
    }
  }

  async submitAudioClip(payload: RecorderSubmission): Promise<void> {
    if (this.state.status !== "finalizing" || payload.sessionId !== this.state.sessionId) {
      return;
    }

    this.clearFinalizationTimer();
    void this.patchTrace(payload.sessionId, { clipReadyAt: new Date().toISOString() });
    const snapshot = this.activeSessionSettings;
    if (!snapshot) {
      this.failSession(payload.sessionId, "The session configuration is missing. Start a new dictation.", "transcription_error");
      return;
    }
    const settings = restoreSessionSettings(snapshot);
    const validationClip = trimSilence(payload.clip, settings.silenceThreshold);
    const rawAudio = analyzeAudioQuality(payload.clip, settings.silenceThreshold);
    const tracePatch: Partial<DictationTrace> = {
      rawAudio,
      trimmedAudio: analyzeAudioQuality(validationClip, settings.silenceThreshold),
      ...(payload.tailMetrics ? payload.tailMetrics : {}),
    };

    debug("dictation", `submitAudioClip: raw=${payload.clip.durationSeconds.toFixed(2)}s, validation=${validationClip.durationSeconds.toFixed(2)}s, minClip=${settings.minClipDuration}s`);

    // Save recording to disk if enabled
    let rawAudioPath: string | null = null;
    if (settings.saveRecordings) {
      rawAudioPath = await this.saveRecordingToDisk(clippedCopy(payload.clip), snapshot);
      tracePatch.rawAudioPath = rawAudioPath;
    }
    void this.patchTrace(payload.sessionId, tracePatch);

    if (this.getMicrophonePermission() !== "granted") {
      debug("dictation", "submitAudioClip: clip rejected (microphone permission is not granted)");
      this.failSession(payload.sessionId, "Microphone access is not granted. Enable it in System Settings > Privacy & Security > Microphone, then restart Vaani.", "microphone_permission_denied");
      return;
    }

    if (!isValidClip(validationClip, settings.minClipDuration)) {
      debug("dictation", "submitAudioClip: clip rejected (too short or empty)");
      this.failSession(payload.sessionId, "No speech detected. Try speaking louder or closer to the microphone.", "no_speech");
      return;
    }

    const speechGate = evaluateSpeechGate(payload.clip.rmsFrames);
    if (!speechGate.pass) {
      debug("dictation", `submitAudioClip: speech gate rejected clip (${speechGate.reason}, floor=${speechGate.noiseFloor.toFixed(4)}, longest=${speechGate.longestRunMs}ms, total=${speechGate.totalSpeechMs}ms)`);
      this.failSession(payload.sessionId, "No speech detected. Try speaking louder or closer to the microphone.", "no_speech");
      return;
    }

    if (settings.retainFailedAudio && this.settings.get().retainFailedAudio) {
      try {
        await this.retainRecoveryAudio(payload.sessionId, validationClip);
      } catch (error) {
        debug("recovery", "audio spooling failed; continuing with text recovery", { sessionId: payload.sessionId, message: error instanceof Error ? error.message : String(error) });
      }
    }

    await this.transitionRecovery(payload.sessionId, "captured");
    await this.transitionRecovery(payload.sessionId, "transcribing");
    if (!this.isCurrentSession(payload.sessionId)) return;
    this.setState({ status: "transcribing", sessionId: payload.sessionId });

    const operationSignal = this.sessionAbortController?.signal;
    try {
      const appProfile = resolveAppProfile(settings.appProfiles ?? [], this.activeTarget?.appBundleId ?? null);
      const language = resolveProfileLanguage(appProfile?.language, settings.language);
      const sttStartedAt = Date.now();
      const transcriptionTimeoutMs = getTranscriptionTimeoutMs(payload.clip);
      const transcriptionDeadlineAt = sttStartedAt + transcriptionTimeoutMs;
      const transcription = await this.transcription.transcribe(payload.clip, {
        sessionSettings: snapshot,
        speechContext: { trimmedDurationSeconds: validationClip.durationSeconds, speechGatePassed: speechGate.pass },
        languageOverride: language,
        ...(appProfile?.transcriptionProvider ? { providerOverride: appProfile.transcriptionProvider } : {}),
          retryClip: validationClip,
          deadlineAt: transcriptionDeadlineAt,
          signal: operationSignal,
        rejectResult: (result: TranscriptionResult) => decideTranscriptInsertion(result.rawText, payload.clip, result.quality).action === "retry",
      });
      if (!this.isCurrentSession(payload.sessionId) || operationSignal?.aborted) return;
      void this.patchTrace(payload.sessionId, { sttDoneAt: new Date().toISOString() });
      const qualityDecision = finalizeTranscriptDecision(decideTranscriptInsertion(transcription.rawText, payload.clip, transcription.quality));
      await this.transitionRecovery(payload.sessionId, "transcript_ready", {
        text: { rawTranscript: transcription.rawText },
        providerAttempts: transcription.providerAttempts?.map(mapProviderAttempt),
        signal: operationSignal,
      });
      if (!this.isCurrentSession(payload.sessionId) || operationSignal?.aborted) return;
      const quality = transcription.quality
        ? { ...transcription.quality, decision: qualityDecision }
        : {
          provider: appProfile?.transcriptionProvider ?? settings.transcriptionProvider,
          attemptCount: 1,
          supportsConfidence: false,
          transcriptLength: transcription.rawText.length,
          decision: qualityDecision,
        };
      void this.patchTrace(payload.sessionId, {
        sttProvider: quality.provider,
        sttLatencyMs: Date.now() - sttStartedAt,
        transcriptLength: transcription.rawText.length,
        quality,
        qualityDecision,
        providerAttempts: transcription.providerAttempts,
        stages: {
          rawTranscript: transcription.rawText,
          qualityDecision: {
            action: qualityDecision.action,
            reason: qualityDecision.reason,
            confidence: quality.confidence,
            noSpeechProbability: quality.noSpeechProbability,
            attemptCount: quality.attemptCount,
          },
        },
      });
      if (!this.isCurrentSession(payload.sessionId)) return;
      if (qualityDecision.action === "reject") {
        debug("dictation", `submitAudioClip: transcript rejected as unreliable (${qualityDecision.reason}): "${transcription.rawText}"`);
        this.failSession(payload.sessionId, "I only caught a fragment. Please try again.", "fragment");
        return;
      }
      if (qualityDecision.action === "save") {
        debug("dictation", `submitAudioClip: transcript saved instead of inserted (${qualityDecision.reason}): "${transcription.rawText}"`);
        const cleanupTrace = { correctionsApplied: [] };
        const correctedText = applyDictionary(transcription.rawText, settings, cleanupTrace);
        if (!this.isCurrentSession(payload.sessionId) || operationSignal?.aborted) return;
        const cleanedText = cleanupText({ rawText: correctedText, settings, trace: cleanupTrace, skipCorrections: true, appProfileId: appProfile?.id, placeholderResolver: resolveSnippetPlaceholder });
        void this.patchTrace(payload.sessionId, { formatDoneAt: new Date().toISOString() });
        void this.patchTrace(payload.sessionId, {
          stages: {
            cleanedText,
            formatterUsed: "none",
            correctionsApplied: cleanupTrace.correctionsApplied,
            injectionStrategy: "none",
          },
        });
        if (!this.isCurrentSession(payload.sessionId) || operationSignal?.aborted) return;
        await this.finishActiveInsertion(payload.sessionId, "failed", {
          id: crypto.randomUUID(),
          traceId: await this.traceIdForSession(payload.sessionId),
          timestamp: new Date().toISOString(),
          rawText: transcription.rawText,
          formattedText: transcription.rawText,
          cleanedText,
          durationSeconds: payload.clip.durationSeconds,
          appBundleId: this.activeTarget?.appBundleId ?? null,
          appName: this.activeTarget?.appName ?? null,
          injectionStatus: "saved",
          injectionMethod: null,
          language: transcription.language,
          detectedLanguage: transcription.detectedLanguage ?? null,
          rawAudioPath,
        }, { injectionMethod: null }, "fragment", transcription.detectedLanguage || transcription.language, undefined, "Transcript quality");
        return;
      }

      // Apply dictionary terms before the formatter so it sees the intended spelling.
      const cleanupTrace = { correctionsApplied: [] };
      const correctedText = applyDictionary(transcription.rawText, settings, cleanupTrace);
      let formattedText = correctedText;
      let formatTrace: FormatTranscriptTraceResult = { text: correctedText, formatterUsed: "none" };
      try {
        await this.transitionRecovery(payload.sessionId, "formatting", { text: { cleanedText: correctedText }, signal: operationSignal });
        const formattingStartedAt = Date.now();
        if (!electron.app.isPackaged && process.env.VAANI_DEV_FORCE_FORMAT_TIMEOUT === "1") throw new TranscriptionDeadlineExceededError();
        formatTrace = await this.formatTranscriptWithTrace(correctedText, operationSignal, Date.now() + FORMATTING_TIMEOUT_MS, snapshot);
        if (!this.isCurrentSession(payload.sessionId) || operationSignal?.aborted) return;
        formattedText = formatTrace.text;
        void this.patchTrace(payload.sessionId, { formattingLatencyMs: Date.now() - formattingStartedAt });
      } catch (error) {
        if (operationSignal?.aborted) return;
        if (error instanceof TranscriptionDeadlineExceededError) {
          formattedText = correctedText;
          formatTrace = { text: correctedText, formatterUsed: "none", formatterStatus: "failed", formatterStatusReason: "Formatting timed out." };
          void this.patchTrace(payload.sessionId, { stages: { formatterStatus: "failed", formatterStatusReason: "Formatting timed out.", formatterReason: "timeout" } });
        } else {
          if (error instanceof TranscriptionCancelledError) return;
          formattedText = correctedText;
          formatTrace = { text: correctedText, formatterUsed: "none" };
        }
      }

      if (!this.isCurrentSession(payload.sessionId) || operationSignal?.aborted) return;
      const formatNotice = formatNoticeFor(formatTrace);
      const cleanedText = cleanupText({ rawText: formattedText, settings, trace: cleanupTrace, skipCorrections: true, appProfileId: appProfile?.id, placeholderResolver: resolveSnippetPlaceholder });
      void this.patchTrace(payload.sessionId, {
        formatDoneAt: new Date().toISOString(),
        stages: {
          cleanedText,
          formatterUsed: formatTrace.formatterUsed,
          formatterStatus: formatTrace.formatterStatus,
          formatterStatusReason: formatTrace.formatterStatusReason,
          contentGuardVerdict: formatTrace.contentGuardVerdict,
          correctionsApplied: cleanupTrace.correctionsApplied,
        },
      });
      if (!this.isCurrentSession(payload.sessionId)) return;
      if (operationSignal?.aborted) return;
      if (!hasSpokenContent(cleanedText)) {
        this.failSession(payload.sessionId, "Nothing to insert. The transcript was empty after cleanup.", "fragment");
        return;
      }
      const initialTarget = this.activeTarget;
      const initialSelection = this.activeSelection;
      const initialTargetValue = this.activeTargetValue;
      const initialTargetIdentity = this.activeTargetIdentity;
      const freshTarget = this.appDetector.getContext();
      const target = freshTarget;
      this.activeTarget = target;
      const currentSelection = this.captureSelection(target);
      const currentValue = safeFocusedValue();
      this.activeSelection = currentSelection;
      const entryBase: Omit<DictationEntry, "injectionStatus" | "injectionMethod"> = {
        id: crypto.randomUUID(),
        traceId: await this.traceIdForSession(payload.sessionId),
        timestamp: new Date().toISOString(),
        rawText: transcription.rawText,
        formattedText,
        cleanedText,
        durationSeconds: payload.clip.durationSeconds,
        appBundleId: target.appBundleId,
        appName: target.appName,
        language: transcription.language,
        detectedLanguage: transcription.detectedLanguage ?? null,
        rawAudioPath,
      };
      this.activePreparedEntry = { ...entryBase, injectionStatus: "saved", injectionMethod: null };

      if (settings.injectionMode === "clipboard") {
        const copied = await this.copyText(cleanedText).catch(() => false);
        await this.finishActiveInsertion(payload.sessionId, copied ? "copy-only" : "failed", {
          ...entryBase, injectionStatus: "saved", injectionMethod: null,
        }, { injectionMethod: null, stages: { injectionStrategy: "none" } }, copied ? undefined : "insertion_failed", transcription.detectedLanguage || transcription.language, undefined, "Clipboard", false, formatNotice);
        return;
      }

      const injectionTarget = {
        appBundleId: target.appBundleId,
        appName: target.appName,
        pid: target.pid,
        selection: currentSelection,
      };
      const currentTargetIdentity = safeFocusedElementIdentity();
      if (!this.isStableAutomaticTarget(initialTarget, initialSelection, initialTargetValue, initialTargetIdentity, target, currentSelection, currentValue, currentTargetIdentity)) {
        const failure = await this.recordFailedActiveInsertion(payload.sessionId, null, "stale_target");
        await this.finishActiveInsertion(payload.sessionId, "refused", { ...entryBase, injectionStatus: "saved", injectionMethod: null }, {
          injectionMethod: null,
          stages: { injectedText: cleanedText, injectionStrategy: "none", insertionVerification: { readable: false, passed: false, repaired: false, reason: "not-at-target" } },
        }, "insertion_failed", transcription.detectedLanguage || transcription.language, failure.outcome);
        return;
      }
      await this.transitionRecovery(payload.sessionId, "text_ready", { text: { formattedText, cleanedText }, signal: operationSignal });
      await this.transitionRecovery(payload.sessionId, "inserting", { text: { formattedText, cleanedText }, signal: operationSignal });
      if (!this.isCurrentSession(payload.sessionId) || operationSignal?.aborted) return;

      const verificationFocus = this.appDetector.getContext();
      const verificationBaseline = sameTarget(injectionTarget, verificationFocus) ? currentValue : null;
      const verificationTarget: Pick<AppContextResult, "appBundleId" | "appName"> | null = this.activeTarget;
      this.activeInsertionPrepared = true;
      await this.prepareRecoveryInsertion(
        payload.sessionId,
        cleanedText,
        injectionTarget,
        verificationBaseline,
        settings.injectionMode,
        payload.sessionId,
        operationSignal,
      );
      if (!this.isCurrentSession(payload.sessionId) || operationSignal?.aborted) return;
      const finalInjectionTarget = this.revalidateAutomaticTarget(initialTarget, initialSelection, initialTargetValue, initialTargetIdentity);
      if (!finalInjectionTarget) {
        const failure = await this.recordFailedActiveInsertion(payload.sessionId, null, "stale_target");
        await this.finishActiveInsertion(payload.sessionId, "refused", { ...entryBase, injectionStatus: "saved", injectionMethod: null }, {
          injectionMethod: null,
          stages: { injectedText: cleanedText, injectionStrategy: "none", insertionVerification: { readable: false, passed: false, repaired: false, reason: "not-at-target" } },
        }, "insertion_failed", transcription.detectedLanguage || transcription.language, failure.outcome);
        return;
      }
      void this.patchTrace(payload.sessionId, { dispatchAt: new Date().toISOString() });
      const injection = await this.injector.inject(cleanedText, finalInjectionTarget, {
        signal: operationSignal,
        onDispatch: () => { if (this.isCurrentSession(payload.sessionId)) this.activeInsertionDispatched = true; },
        isTargetValid: () => this.isCurrentSession(payload.sessionId)
          && this.isSameFocusedTarget(finalInjectionTarget, initialTargetIdentity)
          && (this.activeInsertionDispatched || this.matchesFocusedAX(finalInjectionTarget, initialTargetValue, initialSelection)),
      });
      const injectionAttempts: DictationTrace["injectionAttempts"] = [{
        targetAppBundleId: finalInjectionTarget.appBundleId,
        targetAppName: finalInjectionTarget.appName,
        method: injection.success ? injection.method : null,
        success: injection.success,
      }];
      void this.patchTrace(payload.sessionId, { injectionAttempts });
      if (!this.isCurrentSession(payload.sessionId) || operationSignal?.aborted) return;

      if (injection.success) {
        const verification = await this.verifyInsertion(cleanedText, verificationBaseline, verificationTarget,
          () => this.isCurrentSession(payload.sessionId) && !operationSignal?.aborted);
        void this.patchTrace(payload.sessionId, { verifyDoneAt: new Date().toISOString() });
        const finalAttempt = injectionAttempts[injectionAttempts.length - 1];
        if (finalAttempt) finalAttempt.verification = verification;
        if (!this.isCurrentSession(payload.sessionId) || operationSignal?.aborted) return;
        void this.patchTrace(payload.sessionId, {
          injectionAttempts,
          stages: { insertionVerification: verification },
        });
        const weakEvidence = initialTargetIdentity === null || currentTargetIdentity === null
          || initialTargetValue === null || currentValue === null || initialSelection === null || currentSelection === null;
        if (verification.passed && !weakEvidence) {
          await this.recordRecoveryInsertionOutcome(payload.sessionId, "delivered", injection.method, undefined, undefined);
          await this.finishActiveInsertion(payload.sessionId, "verified", { ...entryBase, injectionStatus: "injected", injectionMethod: injection.method }, {
            injectionMethod: injection.method,
            stages: { injectedText: cleanedText, injectionStrategy: injection.method, insertionVerification: verification },
          }, undefined, transcription.detectedLanguage || transcription.language, "delivered", "Insertion", false, formatNotice);
          debug("editwatch", "arming", { method: injection.method, appBundleId: target.appBundleId, appName: target.appName });
          this.watchForManualEdits(cleanedText, target);
        } else {
          const failure = await this.recordFailedActiveInsertion(payload.sessionId, injection.method, OUTCOME_UNCERTAIN_DETAIL);
          await this.finishActiveInsertion(payload.sessionId, "unconfirmed", { ...entryBase, injectionStatus: "saved", injectionMethod: null }, {
            injectionMethod: null,
            stages: { injectedText: cleanedText, injectionStrategy: "none", insertionVerification: verification },
          }, "insertion_failed", transcription.detectedLanguage || transcription.language, failure.outcome, "Insertion", false, formatNotice);
          debug("editwatch", "arming-unverified-injection", { reason: verification.reason, appBundleId: target.appBundleId, appName: target.appName });
          this.watchForManualEdits(cleanedText, target);
        }
      } else {
        const failure = await this.recordFailedActiveInsertion(payload.sessionId, null, activeInsertionFailureDetail(injection.reason));
        debug("editwatch", "not-armed-injection-saved", { appBundleId: target.appBundleId, appName: target.appName, reason: injection.reason });
        const outcome: DictationInsertionOutcome = this.activeInsertionDispatched || injection.reason === "outcome_uncertain"
          ? "unconfirmed" : injection.reason === "target_changed" || injection.reason === "cancelled" ? "refused" : "failed";
        await this.finishActiveInsertion(payload.sessionId, outcome, { ...entryBase, injectionStatus: "saved", injectionMethod: null }, {
          injectionMethod: null,
          stages: { injectedText: cleanedText, injectionStrategy: "none" },
        }, "insertion_failed", transcription.detectedLanguage || transcription.language, failure.outcome, "Insertion", failure.copied, formatNotice);
      }
    } catch (error) {
      if (!this.isCurrentSession(payload.sessionId)) return;
      const isTimeout = error instanceof TranscriptionDeadlineExceededError;
      const message = isTimeout ? TRANSCRIPTION_TIMEOUT_MESSAGE : error instanceof Error ? error.message : "Dictation failed.";
      const providerAttempts = error instanceof TranscriptionChainError || error instanceof TranscriptionDeadlineExceededError || error instanceof TranscriptionCancelledError
        ? error.providerAttempts
        : [];
      const finalErrorClass = error instanceof TranscriptionChainError ? error.errorClass : undefined;
      if (isTimeout) this.sessionAbortController?.abort("transcription-deadline");
      if (isTimeout) {
        this.failSession(payload.sessionId, message, "timeout", providerAttempts, undefined, "timeout");
        return;
      }
      if (operationSignal?.aborted) return;
      this.failSession(payload.sessionId, message, "transcription_error", providerAttempts, operationSignal, finalErrorClass);
    }
  }

  reportRecorderReady(): void {}

  handleRecorderFailure(payload: RecorderFailure, partialClip?: AudioClip): void {
    if (!this.isCurrentSession(payload.sessionId)) return;
    if (partialClip && this.recovery && this.recoveryAudio && this.recoveryReady()) {
      void this.trackRecoveryRetention(payload.sessionId, partialClip).catch((error) => {
        debug("recovery", "partial audio spooling failed; continuing with text recovery", { sessionId: payload.sessionId, message: error instanceof Error ? error.message : String(error) });
      });
    }
    this.failSession(payload.sessionId, payload.message, "recorder_failure");
  }

  reportHotkeyUnavailable(message: string): void {
    this.clearTimers();
    const statusMessage = message;
    if (this.activeSessionId) void this.finishTrace(this.activeSessionId, "failed", "recorder_unavailable", statusMessage);
    this.activeSessionId = null;
    this.activeSessionSettings = null;
    this.activeTraceId = null;
    this.activeTarget = null;
    this.activeSelection = null;
    this.activeTargetIdentity = null;
    this.setState({ status: "error", sessionId: null, message: statusMessage });
    this.scheduleReset(ERROR_RESET_MS);
  }

  updateAudioLevel(frame: AudioVisualFrame): void {
    if (this.state.status !== "recording" && this.state.status !== "finalizing") return;
    this.clearAudioFrameTimer();
    this.rearmStaleSessionGuard();
    this.overlay.updateBars(frame.bars);
    this.mainWindow?.webContents.send(IpcChannel.AudioLevel, frame.level, frame.bars);
  }

  async reinjectEntry(id: string): Promise<void> {
    if (this.rejectManualInsertionWhileActive()) return;
    const entry = await this.history.getById(id);
    if (!entry) return;
    const result = await this.performManualInsertion(entry.cleanedText, this.currentInjectionTarget(entry));
    if (!result) return;
    const sessionId = this.createSessionId();
    this.setState({ status: "completed", sessionId, outcome: "injected", insertionOutcome: "verified", text: entry.cleanedText, message: "Inserted." });
    this.scheduleReset(SUCCESS_RESET_MS);
  }

  async retryEntry(id: string): Promise<void> {
    if (this.rejectManualInsertionWhileActive() || this.manualRetriesInProgress.has(id)) return;
    this.manualRetriesInProgress.add(id);
    try {
    const entry = await this.history.getById(id);
    if (!entry) return;
    const result = await this.performManualInsertion(entry.cleanedText, this.currentInjectionTarget(entry));
    if (!result) return;
    await this.history.updateById(id, (current) => ({
      ...current,
      injectionStatus: "injected",
      injectionMethod: result.method,
    }));
    if (entry.traceId) {
      void this.safeTraceOperation("retryEntry", entry.traceId, () =>
        this.traces?.updateById(entry.traceId ?? "", (trace) => ({
          ...trace,
          outcome: "verified",
          stages: { ...trace.stages, outcome: "verified" },
          injectionMethod: result.method,
          rejectionReason: undefined,
          userMessage: "Inserted.",
          completedAt: new Date().toISOString(),
        }))
      );
    }
    const sessionId = this.createSessionId();
    this.setState({ status: "completed", sessionId, outcome: "injected", insertionOutcome: "verified", text: entry.cleanedText, message: "Inserted." });
    this.scheduleReset(SUCCESS_RESET_MS);
    } finally {
      this.manualRetriesInProgress.delete(id);
    }
  }

  async getTrace(traceId: string): Promise<DictationTrace | undefined> {
    return this.traces?.getById(traceId);
  }

  async copyRecoveryEntry(id: string): Promise<boolean> {
    if (!this.recovery || !this.recoveryReady()) return false;
    const entry = await this.recovery.getById(id);
    if (!entry || entry.terminal) return false;
    if (entry.state !== "transcript_ready" && entry.state !== "text_ready" && entry.state !== "recoverable") return false;
    const text = selectRecoveryText(entry.text);
    if (!text) return false;
    const copied = await this.copyText(text);
    if (!copied) return false;
    await this.recordRecoveryInsertionOutcome(entry.sessionId, "copied", entry.insertion?.method ?? null, undefined, "Explicit recovery copy.", entry.id);
    return true;
  }

  private rejectLegacyRecoveryRoute(): false {
    this.setState({ status: "error", sessionId: null, message: "This older recovery entry has no saved provider route. Copy or use its raw text, or start a new dictation." });
    this.scheduleReset(ERROR_RESET_MS);
    return false;
  }

  async retryRecoveryTranscription(id: string): Promise<boolean> {
    if (this.rejectManualInsertionWhileActive() || this.manualRetriesInProgress.has(id) || !this.recoveryAudio?.withDecryptedAudio || !this.recovery || !this.recoveryReady()) return false;
    this.manualRetriesInProgress.add(id);
    const action = this.beginRecoveryAction();
    try {
      let entry = await this.recovery.getById(id);
      if (!entry || entry.terminal || !entry.audio) return false;
      if (!entry.settingsSnapshot) return this.rejectLegacyRecoveryRoute();
      const sessionSettings = entry.settingsSnapshot;
      if (entry.state === "recoverable") {
        if (!await this.transitionRecoveryEntry(entry, "retry_wait", {}, action.signal)) return false;
        entry = await this.recovery.getById(id);
        if (!entry) return false;
      }
      if (entry.state !== "captured" && entry.state !== "interrupted_recording" && entry.state !== "retry_wait") return false;
      if (entry.state === "retry_wait") {
        if (!await this.transitionRecoveryEntry(entry, "transcribing", {}, action.signal)) return false;
        entry = await this.recovery.getById(id);
        if (!entry) return false;
      } else {
        if (!await this.transitionRecoveryEntry(entry, "transcribing", {}, action.signal)) return false;
      }
      const transcription = await this.recoveryAudio.withDecryptedAudio(entry.sessionId, async (temporaryPath) => {
        const clip = parseRecoveryWav(await readFile(temporaryPath));
        return this.transcription.transcribe(clip, { sessionSettings, recovery: true, signal: action.signal, deadlineAt: Date.now() + getTranscriptionTimeoutMs(clip) });
      });
      if (action.signal.aborted) return false;
      const current = await this.recovery.getById(id);
      if (!current) return false;
      if (!await this.transitionRecoveryEntry(current, "transcript_ready", {
        text: { rawTranscript: transcription.rawText, cleanedText: transcription.rawText },
        providerAttempts: transcription.providerAttempts?.map(mapProviderAttempt),
        error: { class: "none" },
      }, action.signal)) return false;
      return true;
    } catch (error) {
      const current = await this.recovery.getById(id);
      if (!action.signal.aborted && current && !current.terminal && current.state === "transcribing") {
        await this.transitionRecoveryEntry(current, "recoverable", { error: { class: "transcription_error", detail: error instanceof Error ? error.message : "Recovery transcription failed." } });
      }
      return false;
    } finally {
      this.finishRecoveryAction(action);
      this.manualRetriesInProgress.delete(id);
    }
  }

  async retryRecoveryFormatting(id: string): Promise<boolean> {
    if (this.rejectManualInsertionWhileActive() || this.manualRetriesInProgress.has(id) || !this.recovery || !this.recoveryReady()) return false;
    this.manualRetriesInProgress.add(id);
    const action = this.beginRecoveryAction();
    try {
      const entry = await this.recovery.getById(id);
      const rawText = entry?.text.rawTranscript;
      if (!entry || entry.terminal || !rawText || (entry.state !== "recoverable" && entry.state !== "transcript_ready")) return false;
      if (!entry.settingsSnapshot) return this.rejectLegacyRecoveryRoute();
      if (!await this.transitionRecoveryEntry(entry, "formatting", {}, action.signal)) return false;
      const settings = restoreSessionSettings(entry.settingsSnapshot);
      const appProfile = resolveAppProfile(settings.appProfiles ?? [], entry.target.appBundleId);
      const cleanupTrace = { correctionsApplied: [] };
      const correctedText = applyDictionary(rawText, settings, cleanupTrace);
      const formatted = await this.formatTranscriptWithTrace(correctedText, action.signal, Date.now() + FORMATTING_TIMEOUT_MS, entry.settingsSnapshot);
      if (action.signal.aborted) return false;
      const cleanedText = cleanupText({ rawText: formatted.text, settings, trace: cleanupTrace, skipCorrections: true, appProfileId: appProfile?.id, placeholderResolver: resolveSnippetPlaceholder });
      const current = await this.recovery.getById(id);
      if (!current) return false;
      if (!await this.transitionRecoveryEntry(current, "text_ready", { text: { formattedText: formatted.text, cleanedText }, error: { class: "none" } }, action.signal)) return false;
      return true;
    } catch (error) {
      const current = await this.recovery.getById(id);
      if (!action.signal.aborted && current && !current.terminal && current.state === "formatting") {
        await this.transitionRecoveryEntry(current, "recoverable", { error: { class: "formatting_error", detail: error instanceof Error ? error.message : "Recovery formatting failed." } });
      }
      return false;
    } finally {
      this.finishRecoveryAction(action);
      this.manualRetriesInProgress.delete(id);
    }
  }

  async useRawRecoveryTranscript(id: string): Promise<boolean> {
    if (this.rejectManualInsertionWhileActive() || !this.recovery || !this.recoveryReady()) return false;
    const entry = await this.recovery.getById(id);
    const rawText = entry?.text.rawTranscript;
    if (!entry || entry.terminal || !rawText) return false;
    if (entry.state === "recoverable" || entry.state === "transcript_ready") {
      await this.transitionRecoveryEntry(entry, "text_ready", { text: { cleanedText: rawText, formattedText: rawText }, error: { class: "none" } });
      return true;
    }
    if (entry.state === "text_ready" && this.recovery.updateText) {
      await this.recovery.updateText(entry.id, entry.sessionId, { cleanedText: rawText, formattedText: rawText }, "text_ready");
      return true;
    }
    return false;
  }

  async retryRecoveryInsertion(id: string): Promise<boolean> {
    if (this.rejectManualInsertionWhileActive() || !this.recoveryReady()) return false;
    if (this.cancelledRecoveryRetryIds.delete(id)) return false;
    if (this.manualRetriesInProgress.has(id)) return false;
    this.manualRetriesInProgress.add(id);
    const action = this.beginRecoveryAction();
    const actionGeneration = this.sessionGeneration;
    let prepared = false;
    let dispatched = false;
    let uncertain = false;
    let settled = false;
    let recoverySessionId: string | null = null;
    try {
      if (!this.recovery) return false;
      const entry = await this.recovery.getById(id);
      if (!entry || entry.terminal) return false;
      recoverySessionId = entry.sessionId;
      if (entry.state !== "text_ready" && entry.state !== "recoverable") return false;
      if (entry.insertion?.outcome === "delivered" || entry.insertion?.outcome === "copied") return false;
      if (isUnresolvedInsertion(entry.insertion)) return false;
      const text = selectRecoveryText(entry.text);
      const target = this.currentInjectionTarget({ appBundleId: entry.target.appBundleId, appName: entry.target.appName });
      if (!text || !target) return false;
      const baseline = sameTarget(target, this.appDetector.getContext()) ? safeFocusedValue() : null;
      const identity = safeFocusedElementIdentity();
      if (identity === null) {
        this.setState({ status: "error", sessionId: null, message: "Not inserted: target changed." });
        this.scheduleReset(ERROR_RESET_MS);
        return false;
      }
      prepared = await this.prepareRecoveryInsertion(entry.sessionId, text, target, baseline, this.settings.get().injectionMode, entry.id, action.signal);
      if (!prepared) return false;
      const preparedEntry = await this.recovery.getById(id);
      if (!preparedEntry) return false;
      if (!await this.transitionRecoveryEntry(preparedEntry, "inserting", {}, action.signal)) return false;
      if (action.signal.aborted) return false;
      const insertionEntry = await this.recovery.getById(id);
      if (!insertionEntry || insertionEntry.terminal || insertionEntry.state !== "inserting") return false;
      const latestTarget = this.currentInjectionTarget({ appBundleId: entry.target.appBundleId, appName: entry.target.appName });
      const latestBaseline = latestTarget && sameTarget(latestTarget, this.appDetector.getContext()) ? safeFocusedValue() : null;
      if (actionGeneration !== this.sessionGeneration || !latestTarget || !sameTarget(latestTarget, target)) return false;
      if (!this.isSameFocusedTarget(target, identity)) {
        this.setState({ status: "error", sessionId: null, message: "Not inserted: target changed." });
        this.scheduleReset(ERROR_RESET_MS);
        return false;
      }
      if ((baseline !== null && latestBaseline !== null && baseline !== latestBaseline)
        || (target.selection && latestTarget.selection && (target.selection.location !== latestTarget.selection.location || target.selection.length !== latestTarget.selection.length))) return false;
      const result = await this.performManualInsertion(text, latestTarget, action.signal, actionGeneration, () => { uncertain = true; }, () => { dispatched = true; }, identity);
      if (!result) {
        const detail = dispatched || uncertain ? OUTCOME_UNCERTAIN_DETAIL : "Manual recovery retry was not verified.";
        await this.recordRecoveryInsertionOutcome(entry.sessionId, "recoverable", null, "insertion_failed", detail, entry.id);
        settled = true;
        return false;
      }
      await this.recordRecoveryInsertionOutcome(entry.sessionId, "delivered", result.method, undefined, undefined, entry.id);
      settled = true;
      return true;
    } catch (error) {
      debug("recovery", "manual recovery insertion failed", { id, message: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      if (prepared && !settled && recoverySessionId) {
        await this.recordRecoveryInsertionOutcome(recoverySessionId, "recoverable", null, "insertion_failed", dispatched || uncertain ? OUTCOME_UNCERTAIN_DETAIL : "Manual recovery retry was interrupted.", id).catch((error) => {
          debug("recovery", "manual recovery insertion outcome could not be journaled", { id, message: error instanceof Error ? error.message : String(error) });
        });
      }
      this.finishRecoveryAction(action);
      if (action.signal.aborted) this.cancelledRecoveryRetryIds.add(id);
      this.manualRetriesInProgress.delete(id);
    }
  }

  async retryRecoveryEntry(id: string): Promise<boolean> {
    return this.retryRecoveryInsertion(id);
  }

  async exportBugReport(entryId: string, appVersion?: string): Promise<DictationBugReport> {
    const entry = await this.history.getById(entryId) ?? null;
    const trace = entry?.traceId ? await this.safeTraceOperation("exportBugReport", entry.traceId, () => this.traces?.getById(entry.traceId ?? "")) ?? null : null;
    return createDictationBugReport(entry, trace, new Date().toISOString(), appVersion);
  }

  async pasteLatestEntry(): Promise<void> {
    if (this.pasteLatestInProgress) return;
    if (this.state.status === "starting" || this.state.status === "recording" || this.state.status === "finalizing" || this.state.status === "transcribing") return;

    this.pasteLatestInProgress = true;
    try {
      const latest = await this.history.getLatest();
      if (!latest) {
        this.setState({ status: "error", sessionId: null, message: "No previous dictation is available yet." });
        this.scheduleReset(ERROR_RESET_MS);
        return;
      }
      const result = await this.performManualInsertion(latest.cleanedText, this.currentInjectionTarget(latest));
      if (!result) return;
      const sessionId = this.createSessionId();
      this.setState({ status: "completed", sessionId, outcome: "injected", insertionOutcome: "verified", text: latest.cleanedText, message: "Inserted." });
      this.scheduleReset(SUCCESS_RESET_MS);
    } finally {
      this.pasteLatestInProgress = false;
    }
  }

  getState(): DictationState { return this.state; }

  getActiveSessionForLifecycle(): { sessionId: string; generation: number } | null {
    if (!this.activeSessionId || this.state.status === "idle" || this.state.status === "completed" || this.state.status === "error") return null;
    return { sessionId: this.activeSessionId, generation: this.sessionGeneration };
  }

  async handleLifecycleSuspended(sessionId: string, generation: number, partialClip?: AudioClip): Promise<boolean> {
    if (!this.isCurrentLifecycleSession(sessionId, generation)) return false;
    if (partialClip) await this.trackRecoveryRetention(sessionId, partialClip);
    return true;
  }

  async handleLifecycleRouteHandoff(sessionId: string, generation: number, handoff: NonNullable<RecoveryEntry["routeHandoff"]>): Promise<boolean> {
    if (!this.isCurrentLifecycleSession(sessionId, generation)) return false;
    if (!this.recovery || !this.recoveryReady()) return true;
    await this.recovery.markRouteHandoff?.(sessionId, sessionId, handoff);
    return true;
  }

  async handleLifecycleInterruption(
    sessionId: string,
    generation: number,
    message: string,
    errorClass: RecoveryErrorClass,
    partialClip?: AudioClip,
    routeHandoff?: NonNullable<RecoveryEntry["routeHandoff"]>,
  ): Promise<boolean> {
    if (!this.isCurrentLifecycleSession(sessionId, generation)) return false;
    const sessionAbortController = this.sessionAbortController;
    const recorder = this.recorder;
    const fencedGeneration = this.sessionGeneration + 1;
    recorder?.abortRecording?.(sessionId);
    sessionAbortController?.abort("lifecycle-interruption");
    this.sessionGeneration = fencedGeneration;
    if (partialClip) await this.trackRecoveryRetention(sessionId, partialClip);
    if (routeHandoff) await this.handleLifecycleRouteHandoff(sessionId, fencedGeneration, routeHandoff);
    if (this.activeSessionId !== sessionId || this.sessionGeneration !== fencedGeneration) return false;
    this.failSession(sessionId, message, "recorder_failure", [], undefined, errorClass);
    return true;
  }

  async demoTranscribe(clip: { pcmData: number[]; sampleRate: number; durationSeconds: number; rmsFrames: number[] }): Promise<string> {
    const action = this.beginRecoveryAction();
    const transcriptionTimeoutMs = getTranscriptionTimeoutMs(clip);
    const transcriptionDeadlineAt = Date.now() + transcriptionTimeoutMs;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const result = await Promise.race<TranscriptionResult>([
        this.transcription.transcribe(clip, { signal: action.signal, sessionSettings: captureSessionSettings(this.settings.get()), deadlineAt: transcriptionDeadlineAt }),
        new Promise<TranscriptionResult>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(TRANSCRIPTION_TIMEOUT_MESSAGE)), transcriptionTimeoutMs);
        }),
      ]);
      return result.rawText;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      action.controller.abort("demo-finished");
      this.finishRecoveryAction(action);
    }
  }

  async getById(id: string): Promise<DictationEntry | undefined> {
    return this.history.getById(id);
  }

  async showDictionarySuggestions(suggestions: DictionarySuggestion[]): Promise<void> {
    const promptGeneration = this.dictionaryPromptGeneration;
    for (const suggestion of suggestions) {
      if (!this.isPromptableDictionarySuggestion(suggestion)) continue;

      const accepted = await new Promise<boolean>((resolve) => {
        this.overlay.showDictionaryPrompt(suggestion.spoken, suggestion.written, resolve);
      });
      if (promptGeneration !== this.dictionaryPromptGeneration) {
        debug("dictionary", "stale suggestion response discarded", { spoken: suggestion.spoken, written: suggestion.written });
        return;
      }
      if (accepted) this.applyDictionarySuggestion(suggestion);
      else debug("dictionary", "suggestion dismissed", { spoken: suggestion.spoken, written: suggestion.written });
    }
  }

  purgeAutoSuggestedCorrections(): Settings {
    const current = this.settings.get().customCorrections ?? [];
    const nextCorrections = current.filter((entry) => entry.source !== "auto-suggested");
    const removed = current.length - nextCorrections.length;
    debug("dictionary", "purged auto-suggested corrections", { removed });
    return this.settings.update({ customCorrections: nextCorrections });
  }

  private async showSnippetSuggestion(content: string): Promise<void> {
    const trigger = buildSnippetTrigger(content, this.settings.get().snippets ?? []);
    const accepted = await new Promise<boolean>((resolve) => {
      this.overlay.showSnippetPrompt(trigger, resolve);
    });
    if (!accepted) return;

    const current = this.settings.get().snippets ?? [];
    if (current.some((snippet) => snippet.trigger.toLowerCase() === trigger.toLowerCase())) return;
    this.settings.update({ snippets: [...current, { trigger, content }] });
  }

  navigateToHistoryEntry(entryId: string): void {
    const route = `/app/history?editEntryId=${encodeURIComponent(entryId)}`;
    this.mainWindow?.show();
    this.mainWindow?.focus();
    this.mainWindow?.webContents.send(IpcChannel.Navigation, { route });
  }

  private async saveRecordingToDisk(clip: { pcmData: number[]; sampleRate: number; durationSeconds: number; rmsFrames: number[] }, settings: SessionSettingsSnapshot): Promise<string | null> {
    try {
      if (!settings.saveRecordings || !this.settings.get().saveRecordings) return null;
      const dir = settings.recordingsPath || join(homedir(), "Documents", "Vaani Recordings");
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `vaani-recording-${timestamp}.wav`;
      const filepath = join(dir, filename);

      const dataSize = clip.pcmData.length * 2;
      const buf = Buffer.alloc(44 + dataSize);
      buf.write("RIFF", 0);
      buf.writeUInt32LE(36 + dataSize, 4);
      buf.write("WAVE", 8);
      buf.write("fmt ", 12);
      buf.writeUInt32LE(16, 16);
      buf.writeUInt16LE(1, 20);
      buf.writeUInt16LE(1, 22);
      buf.writeUInt32LE(clip.sampleRate, 24);
      buf.writeUInt32LE(clip.sampleRate * 2, 28);
      buf.writeUInt16LE(2, 32);
      buf.writeUInt16LE(16, 34);
      buf.write("data", 36);
      buf.writeUInt32LE(dataSize, 40);
      for (let i = 0; i < clip.pcmData.length; i++) {
        const s = Math.max(-1, Math.min(1, clip.pcmData[i] ?? 0));
        buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
      }
      if (!this.settings.get().saveRecordings) return null;
      await writeFile(filepath, buf);
      if (!this.settings.get().saveRecordings) { await unlink(filepath); return null; }
      return filepath;
    } catch {
      // Best-effort saving
      return null;
    }
  }

  private currentInjectionTarget(_entry: Pick<DictationEntry, "appBundleId" | "appName">) {
    const current = this.appDetector.getContext();
    if (isExternalTarget(current)) {
      return { appBundleId: current.appBundleId, appName: current.appName, pid: current.pid, selection: this.captureSelection(current) };
    }
    return undefined;
  }

  private rejectManualInsertionWhileActive(): boolean {
    if (this.state.status !== "starting" && this.state.status !== "recording" && this.state.status !== "finalizing" && this.state.status !== "transcribing") return false;
    this.overlay.setError();
    return true;
  }

  private async performManualInsertion(
    text: string,
    target: { appBundleId: string | null; appName: string | null; pid?: number | null; selection: SelectionRange | null } | undefined,
    signal?: AbortSignal,
    expectedGeneration = this.sessionGeneration,
    onUncertain?: () => void,
    onDispatch?: () => void,
    expectedIdentity?: string | null,
  ): Promise<{ method: "ax" | "clipboard" } | null> {
    if (signal?.aborted || expectedGeneration !== this.sessionGeneration) return null;
    if (!target || !isExternalTarget(target)) {
      this.setState({ status: "error", sessionId: null, message: "Focus an external text field before retrying insertion." });
      this.scheduleReset(ERROR_RESET_MS);
      return null;
    }
    const baselineFocus = this.appDetector.getContext();
    const baseline = sameTarget(target, baselineFocus) ? safeFocusedValue() : null;
    const identity = expectedIdentity === undefined ? safeFocusedElementIdentity() : expectedIdentity;
    if (identity === null) {
      this.setState({ status: "error", sessionId: null, message: "Not inserted: target changed." });
      this.scheduleReset(ERROR_RESET_MS);
      return null;
    }
    if (!sameTarget(target, this.appDetector.getContext())) {
      this.setState({ status: "error", sessionId: null, message: "The focused text field changed. Focus the intended field and retry." });
      this.scheduleReset(ERROR_RESET_MS);
      return null;
    }
    if (this.sessionGeneration !== expectedGeneration || signal?.aborted) return null;
    if (!this.isSameFocusedTarget(target, identity)) {
      this.setState({ status: "error", sessionId: null, message: "Not inserted: target changed." });
      this.scheduleReset(ERROR_RESET_MS);
      return null;
    }
    let dispatched = false;
    const result = await this.injector.inject(text, target, {
      signal,
      onDispatch: () => { dispatched = true; onDispatch?.(); },
      isTargetValid: () => this.sessionGeneration === expectedGeneration && this.isSameFocusedTarget(target, identity)
        && (dispatched || this.matchesFocusedAX(target, baseline, target.selection ?? null)),
    });
    if (!result.success && result.reason === "outcome_uncertain") onUncertain?.();
    if (this.sessionGeneration !== expectedGeneration || signal?.aborted) return null;
    if (!result.success) {
      this.setState({ status: "error", sessionId: null, message: messageForInjectionFailure(result.reason) });
      this.scheduleReset(ERROR_RESET_MS);
      return null;
    }
    const verification = await this.verifyInsertion(text, baseline, target,
      () => this.sessionGeneration === expectedGeneration && !signal?.aborted);
    if (this.sessionGeneration !== expectedGeneration || signal?.aborted) return null;
    if (!verification.passed) {
      onUncertain?.();
      this.setState({ status: "error", sessionId: null, message: "Insertion could not be verified. Use Copy to recover the text." });
      this.scheduleReset(ERROR_RESET_MS);
      return null;
    }
    return result;
  }

  private isPromptableDictionarySuggestion(suggestion: DictionarySuggestion): boolean {
    const spoken = suggestion.spoken.trim();
    const written = suggestion.written.trim();
    if (!isValidDictionarySuggestion({ spoken, written }) || !isAutoLearnableDictionarySuggestion({ spoken, written })) {
      debug("dictionary", "invalid suggestion dropped", { spoken, written });
      return false;
    }
    const current = this.settings.get().customCorrections ?? [];
    const existing = current.find((entry) => entry.spoken.toLowerCase() === spoken.toLowerCase());
    if (existing?.written === written) {
      debug("dictionary", "suggestion already present", { spoken, written });
      return false;
    }
    return true;
  }

  private applyDictionarySuggestion(suggestion: DictionarySuggestion): void {
    const spoken = suggestion.spoken.trim();
    const written = suggestion.written.trim();
    if (!this.isPromptableDictionarySuggestion({ spoken, written })) return;
    const current = this.settings.get().customCorrections ?? [];
    const existingIndex = current.findIndex((entry) => entry.spoken.toLowerCase() === spoken.toLowerCase());
    const previous = existingIndex >= 0 ? current[existingIndex] : undefined;
    if (previous && previous.source !== "auto-suggested") {
      debug("dictionary", "manual suggestion preserved", { spoken, written });
      return;
    }
    const nextCorrections = existingIndex >= 0
      ? current.map((entry, index) => index === existingIndex ? { ...entry, spoken, written, source: "auto-suggested" as const } : entry)
      : [...current, { spoken, written, source: "auto-suggested" as const }];
    this.settings.update({ customCorrections: nextCorrections });
  }

  private watchForManualEdits(insertedText: string, target: Pick<AppContextResult, "appBundleId" | "appName"> | null): void {
    this.clearEditWatch();
    if (!isExternalTarget(target) || !nativeBridge.getFocusedValue) {
      debug("editwatch", "skip", { external: isExternalTarget(target), hasGetFocusedValue: !!nativeBridge.getFocusedValue });
      return;
    }

    // The field value can be unreadable at the injection instant (paste still
    // settling, transient focus on the overlay, AX not yet ready). Establish the
    // baseline LAZILY on the first readable poll so a momentary null no longer
    // kills the entire watch — which silently disabled the correction popup.
    let baseline = safeFocusedValue();
    debug("editwatch", "start", { baselineReadable: baseline !== null });

    this.timers.setInterval("editWatch", () => {
      if (!sameTarget(target, this.appDetector.getContext())) return;

      const currentValue = safeFocusedValue();
      if (currentValue === null) return;

      if (baseline === null) {
        const correctedCandidate = extractCorrectedInsertedText(insertedText, currentValue, insertedText);
        const suggestionCount = correctedCandidate && correctedCandidate !== insertedText
          ? detectDictionarySuggestions(insertedText, correctedCandidate).length
          : 0;
        baseline = currentValue;
        debug("editwatch", "baseline-recovered", { correctedOnFirstRead: suggestionCount > 0 });
        if (correctedCandidate && suggestionCount > 0) {
          this.scheduleEditPrompt(insertedText, correctedCandidate);
        }
        return;
      }
      if (currentValue === baseline || currentValue === insertedText) return;

      const correctedCandidate = extractCorrectedInsertedText(baseline, currentValue, insertedText);
      if (!correctedCandidate || insertedText === correctedCandidate) return;

      this.scheduleEditPrompt(insertedText, correctedCandidate);
    }, EDIT_WATCH_INTERVAL_MS);

    this.timers.setTimeout("editWatchTimeout", () => this.clearEditWatch(), EDIT_WATCH_TIMEOUT_MS);
  }

  private scheduleEditPrompt(insertedText: string, correctedCandidate: string): void {
    const key = `${insertedText}\u0000${correctedCandidate}`;
    if (this.pendingEditPromptKey === key) return;
    this.clearEditPromptTimer();
    this.pendingEditPromptKey = key;
    this.pendingEdit = { insertedText, correctedCandidate };
    // Debounce so we prompt only once the user stops typing the correction.
    this.timers.setTimeout("editPrompt", () => {
      // Stop polling but keep the pending edit — promptPendingEdit consumes it.
      this.timers.clear("editWatch");
      this.timers.clear("editWatchTimeout");
      void this.promptPendingEdit();
    }, EDIT_PROMPT_IDLE_MS);
  }

  private async promptPendingEdit(): Promise<void> {
    const pending = this.pendingEdit;
    this.clearEditPromptTimer();
    if (!pending) return;

    const { insertedText, correctedCandidate } = pending;
    const suggestions = detectDictionarySuggestions(insertedText, correctedCandidate);
    debug("editwatch", "prompt", { suggestionCount: suggestions.length, snippetLike: isSnippetLikeContent(correctedCandidate) });

    if (suggestions.length > 0 && !isSnippetLikeContent(correctedCandidate)) {
      await this.showDictionarySuggestions(suggestions);
      return;
    }

    if (shouldSuggestSnippet(insertedText, correctedCandidate)) {
      void this.showSnippetSuggestion(correctedCandidate);
    }
  }

  private discardPendingEdit(reason: string): void {
    if (this.pendingEdit) {
      debug("editwatch", "discard pending suggestion", { reason });
    }
    this.clearEditPromptTimer();
  }

  private cancelDictionaryPrompts(reason: string): void {
    this.dictionaryPromptGeneration += 1;
    debug("dictionary", "prompts invalidated", { reason, generation: this.dictionaryPromptGeneration });
  }

  private completeSession(sessionId: string, outcome: DictationCompletionOutcome | "failed", text: string, message: string, detectedLanguage?: string | null, recoveryOutcome?: RecoveryInsertionTerminalOutcome, insertionOutcome?: DictationInsertionOutcome): void {
    if (!this.isCurrentSession(sessionId)) return;
    if (outcome === "injected" && this.recoveryAudio && this.recoveryReady()) {
      void this.queueRecoveryMutation(async () => this.recoveryAudio?.deleteForSession(sessionId)).catch((error) => {
        debug("recovery", "successful-session audio cleanup failed", { sessionId, message: error instanceof Error ? error.message : String(error) });
      });
    }
    if (!this.recordedInsertionOutcomes.has(sessionId)) {
      void this.transitionRecovery(sessionId, outcome === "injected" ? "delivered" : "recoverable", {
        text: { cleanedText: text, formattedText: text },
        insertion: outcome === "injected" ? { status: "verified", outcome: "delivered", method: null } : { status: "failed", outcome: "recoverable", reason: "insertion_failed" },
        error: outcome === "injected" ? { class: "none" } : { class: "insertion_failed", detail: message },
        terminal: outcome === "injected" ? "delivered" : null,
      });
    }
    this.clearAudioFrameTimer();
    this.setState({ status: "completed", sessionId, outcome, text, message, detectedLanguage, ...(recoveryOutcome ? { recoveryOutcome } : {}), ...(insertionOutcome ? { insertionOutcome } : {}) });
    this.scheduleReset(SUCCESS_RESET_MS);
  }

  private async finishActiveInsertion(
    sessionId: string,
    outcome: DictationInsertionOutcome,
    entry: DictationEntry,
    tracePatch: Partial<DictationTrace>,
    reason?: DictationRejectionReason,
    detectedLanguage?: string | null,
    recoveryOutcome?: RecoveryInsertionTerminalOutcome,
    failedStage = "Insertion",
    copied = false,
    formatNotice: string | null = null,
  ): Promise<void> {
    const historySaved = await this.persistHistoryOnce(sessionId, entry);
    if (!this.isCurrentSession(sessionId)) return;
    const statusText = insertionStatusText(outcome, historySaved, historySaved ? failedStage : "History", copied);
    const message = formatNotice ? `${statusText} ${formatNotice}` : statusText;
    void this.finishTrace(sessionId, outcome, reason, message, tracePatch);
    this.completeSession(sessionId, outcome === "verified" ? "injected" : historySaved ? "saved" : "failed", entry.cleanedText, message, detectedLanguage, recoveryOutcome, outcome);
    if (outcome === "unconfirmed") {
      this.overlay.setStatusMessage?.(`${message} ${historySaved ? "Find this session in History." : "History could not save this session."}`);
    }
  }

  private persistHistoryOnce(sessionId: string, entry: DictationEntry): Promise<boolean> {
    const existing = this.historyWrites.get(sessionId);
    if (existing) return existing;
    const write = Promise.resolve().then(() => this.history.append(entry)).then(() => true, (error: unknown) => {
      debug("dictation", "history append failed", { sessionId, message: error instanceof Error ? error.message : String(error) });
      return false;
    });
    this.historyWrites.set(sessionId, write);
    return write;
  }

  private async settleInterruptedInsertion(sessionId: string): Promise<void> {
    const entry = this.activePreparedEntry;
    if (!entry) return;
    const saved = await this.persistHistoryOnce(sessionId, entry);
    await this.recordRecoveryInsertionOutcome(sessionId, "recoverable", null, "interrupted", OUTCOME_UNCERTAIN_DETAIL).catch(() => undefined);
    await this.finishTrace(sessionId, "unconfirmed", "cancelled", insertionStatusText("unconfirmed", saved, "processing"));
    this.historyWrites.delete(sessionId);
  }

  private failSession(sessionId: string, message: string, reason: DictationRejectionReason = "transcription_error", providerAttempts: ProviderAttemptTrace[] = [], signal?: AbortSignal, errorClass?: RecoveryErrorClass, tracePatch: Partial<DictationTrace> = {}): void {
    if (!this.isCurrentSession(sessionId)) return;
    void this.transitionRecovery(sessionId, "recoverable", { error: { class: errorClass ?? recoveryErrorClass(reason), detail: message }, providerAttempts: providerAttempts.map(mapProviderAttempt), signal });
    this.clearRecorderStartTimer();
    this.clearAudioFrameTimer();
    this.clearFinalizationTimer();
    this.setState({ status: "error", sessionId, message });
    void this.finishTrace(sessionId, reason === "no_speech" || reason === "microphone_permission_denied" || reason === "fragment" ? "rejected" : "failed", reason, message, tracePatch);
    this.scheduleReset(ERROR_RESET_MS);
  }

  private resetToIdle(): void {
    if (this.activeSessionId) {
      this.historyWrites.delete(this.activeSessionId);
    }
    this.sessionAbortController?.abort("session-reset");
    this.clearTimers();
    this.activeSessionId = null;
    this.activeSessionSettings = null;
    this.activeTarget = null;
    this.activeSelection = null;
    this.activeTargetValue = null;
    this.activeTargetIdentity = null;
    this.activeInsertionPrepared = false;
    this.activeInsertionDispatched = false;
    this.activePreparedEntry = null;
    this.releaseRequestedDuringStart = false;
    this.setState({ status: "idle" });
  }

  private scheduleReset(timeoutMs: number): void {
    this.clearResetTimer();
    this.timers.setTimeout("reset", () => this.resetToIdle(), timeoutMs);
  }

  private clearTimers(): void {
    this.clearResetTimer();
    this.clearRecorderStartTimer();
    this.clearFinalizationTimer();
    this.clearAudioFrameTimer();
    this.clearStaleSessionTimer();
  }

  private clearResetTimer(): void { this.timers.clear("reset"); }
  private clearFinalizationTimer(): void { this.timers.clear("finalization"); }
  private clearAudioFrameTimer(): void { this.timers.clear("audioFrame"); }
  private clearRecorderStartTimer(): void { this.timers.clear("recorderStart"); }
  private clearStaleSessionTimer(): void { this.timers.clear("staleSession"); }
  private clearEditWatch(): void {
    this.timers.clear("editWatch");
    this.timers.clear("editWatchTimeout");
    this.clearEditPromptTimer();
  }
  private clearEditPromptTimer(): void {
    this.timers.clear("editPrompt");
    this.pendingEditPromptKey = null;
    this.pendingEdit = null;
  }

  clearUptimeLogging(): void {
    this.timers.clear("uptimeLog");
  }

  destroy(): void {
    this.cancelRecoveryActions("destroyed");
    this.sessionAbortController?.abort("destroyed");
    this.clearResetTimer();
    this.clearFinalizationTimer();
    this.clearAudioFrameTimer();
    this.clearRecorderStartTimer();
    this.clearStaleSessionTimer();
    this.clearEditWatch();
    this.clearUptimeLogging();
  }

  async flushRecovery(): Promise<void> {
    await this.recoveryEntryReady;
    while (this.recoveryRetentionPromises.size > 0) {
      await Promise.allSettled([...this.recoveryRetentionPromises]);
    }
    await this.recoveryMutation;
  }

  private isCurrentSession(sessionId: string): boolean { return this.activeSessionId === sessionId; }

  private isCurrentLifecycleSession(sessionId: string, generation: number): boolean {
    return this.activeSessionId === sessionId && this.sessionGeneration === generation;
  }

  private async startRecoveryEntry(sessionId: string): Promise<void> {
    if (!this.recovery || !this.recoveryReady()) return;
    const entry = createRecoveryEntry({
      id: sessionId,
      sessionId,
      buildIdentifier: formatBuildIdentifier(getElectronAppVersion()),
      target: {
        appBundleId: this.activeTarget?.appBundleId,
        appName: this.activeTarget?.appName,
      },
      settingsSnapshot: this.activeSessionSettings ?? undefined,
      retentionMs: (this.activeSessionSettings?.recoveryRetentionDays ?? this.settings.get().recoveryRetentionDays) * 24 * 60 * 60 * 1000,
    });
    await this.queueRecoveryMutation(async () => {
      await this.recovery?.create(entry);
    });
  }

  private async retainRecoveryAudio(sessionId: string, clip: AudioClip): Promise<void> {
    await this.recoveryEntryReady;
    const entry = await this.recovery?.getById(sessionId);
    if (!entry || !this.recoveryAudio || !this.recoveryReady()) return;
    if (!entry.settingsSnapshot?.retainFailedAudio || !this.settings.get().retainFailedAudio) {
      await this.recovery?.updateRecoveryMode?.(entry.id, entry.sessionId, "text-only", {
        class: "recovery_storage_failure",
        detail: "Failed-audio retention is disabled; text recovery is retained.",
      });
      return;
    }
    const result = await this.recoveryAudio.spool(entry, clip, entry.settingsSnapshot.silenceThreshold);
    if (!this.settings.get().retainFailedAudio) {
      await this.recoveryAudio.deleteForSession(sessionId);
      await this.recovery?.updateRecoveryMode?.(entry.id, entry.sessionId, "text-only");
      return;
    }
    if (result.mode === "text-only") {
      await this.recovery?.updateRecoveryMode?.(
        entry.id,
        entry.sessionId,
        "text-only",
        {
          class: result.reason === "key-unavailable" || result.reason === "key-corrupt"
            ? result.reason === "key-corrupt" ? "recovery_key_corrupt" : "recovery_key_unavailable"
            : result.reason === "cap-reached" ? "recovery_cap_reached" : "recovery_storage_failure",
          detail: result.detail,
        },
      );
    }
  }

  private trackRecoveryRetention(sessionId: string, clip: AudioClip): Promise<void> {
    let tracked: Promise<void>;
    tracked = this.retainRecoveryAudio(sessionId, clip).finally(() => {
      this.recoveryRetentionPromises.delete(tracked);
    });
    this.recoveryRetentionPromises.add(tracked);
    return tracked;
  }

  private async prepareRecoveryInsertion(
    sessionId: string,
    text: string,
    target: { appBundleId: string | null; appName: string | null },
    baseline: string | null,
    mode: Settings["injectionMode"],
    entryId = sessionId,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const prepareInsertion = this.recovery?.prepareInsertion;
    if (!prepareInsertion || !this.recoveryReady()) return false;
    if (signal?.aborted) return false;
    await this.recoveryEntryReady;
    let prepared = false;
    await this.queueRecoveryMutation(async () => {
      const entry = await this.recovery?.getById(entryId);
      if (!entry || entry.sessionId !== sessionId) return;
      if (signal?.aborted) return;
      const targetFingerprint = { appBundleId: target.appBundleId, appName: target.appName, windowTitle: null };
      const preparation: RecoveryInsertionPreparation = {
        targetFingerprint,
        appIdentity: targetFingerprint,
        baselineReadable: baseline !== null,
        baselineHash: baseline === null ? null : hashText(baseline),
        textHash: hashText(text),
        intendedStrategy: intendedInjectionStrategy(text, target, mode),
        deadlineAt: new Date(Date.now() + INSERTION_VERIFY_TIMEOUT_MS).toISOString(),
      };
      const next = await prepareInsertion(entry.id, sessionId, preparation);
      prepared = !!next && !next.terminal && next.insertion?.outcome === "pending";
    });
    return prepared;
  }

  private async recordRecoveryInsertionOutcome(
    sessionId: string,
    outcome: RecoveryInsertionTerminalOutcome,
    method: "ax" | "clipboard" | null,
    reason: RecoveryErrorClass | undefined,
    detail: string | undefined,
    entryId = sessionId,
    signal?: AbortSignal,
  ): Promise<void> {
    const recordInsertionOutcome = this.recovery?.recordInsertionOutcome;
    if (!recordInsertionOutcome || !this.recoveryReady()) return;
    await this.recoveryEntryReady;
    await this.queueRecoveryMutation(async () => {
      const entry = await this.recovery?.getById(entryId);
      if (!entry || entry.sessionId !== sessionId) return;
      if (signal?.aborted) return;
      await recordInsertionOutcome(entry.id, sessionId, outcome, { method, reason, detail });
      this.recordedInsertionOutcomes.add(sessionId);
    });
  }

  private async recordFailedActiveInsertion(
    sessionId: string,
    method: "ax" | "clipboard" | null,
    reason: string,
  ): Promise<{ outcome: RecoveryInsertionTerminalOutcome; copied: boolean }> {
    const errorClass: RecoveryErrorClass = reason === "timeout" ? "timeout" : "insertion_failed";
    if (this.recovery?.recordInsertionOutcome && this.recoveryReady()) {
      try {
        await this.recordRecoveryInsertionOutcome(sessionId, "recoverable", method, errorClass, reason);
        return { outcome: "recoverable", copied: false };
      } catch (error) {
        debug("recovery", "durable insertion recovery failed", { sessionId, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { outcome: "recoverable", copied: false };
  }

  private async transitionRecovery(
    sessionId: string,
    to: RecoveryState,
    patch: {
      text?: { rawTranscript?: string; cleanedText?: string; formattedText?: string };
      providerAttempt?: RecoveryEntry["providerAttempts"][number] | null;
      providerAttempts?: RecoveryEntry["providerAttempts"];
      insertion?: RecoveryEntry["insertion"];
      error?: { class: RecoveryErrorClass; detail?: string };
      terminal?: RecoveryEntry["terminal"];
      signal?: AbortSignal;
    } = {},
  ): Promise<void> {
    if (!this.recovery || !this.recoveryReady()) return;
    await this.recoveryEntryReady;
    const { signal, ...transitionPatch } = patch;
    await this.queueRecoveryMutation(async () => {
      const entry = await this.recovery?.getById(sessionId);
      if (!entry || entry.sessionId !== sessionId) return;
      if (signal?.aborted) return;
      try {
        await this.recovery?.transition({
          entryId: entry.id,
          sessionId,
          transitionId: `${sessionId}:${entry.attempt + 1}:${to}`,
          to,
          attempt: entry.attempt + 1,
          occurredAt: new Date().toISOString(),
          buildIdentifier: formatBuildIdentifier(getElectronAppVersion()),
          ...transitionPatch,
        });
      } catch (error) {
        debug("recovery", "transition rejected", { sessionId, to, message: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  private async transitionRecoveryEntry(
    entry: RecoveryEntry,
    to: RecoveryState,
    patch: Pick<Parameters<RecoveryJournalStore["transition"]>[0], "text" | "providerAttempts" | "error"> = {},
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (!this.recovery || !this.recoveryReady()) return false;
    if (signal?.aborted) return false;
    let applied = false;
    await this.queueRecoveryMutation(async () => {
      if (signal?.aborted) return;
      const next = await this.recovery?.transition({
        entryId: entry.id,
        sessionId: entry.sessionId,
        transitionId: `${entry.id}:manual:${entry.attempt + 1}:${to}`,
        to,
        attempt: entry.attempt + 1,
        occurredAt: new Date().toISOString(),
        buildIdentifier: formatBuildIdentifier(getElectronAppVersion()),
        ...patch,
      });
      applied = next?.state === to;
    });
    return applied;
  }

  private queueRecoveryMutation(operation: () => Promise<void>): Promise<void> {
    const run = this.recoveryMutation.catch(() => undefined).then(operation);
    this.recoveryMutation = run.catch(() => undefined);
    return run;
  }

  private beginRecoveryAction(): { signal: AbortSignal; controller: AbortController } {
    const controller = new AbortController();
    this.recoveryActionAbortControllers.add(controller);
    return { controller, signal: controller.signal };
  }

  private finishRecoveryAction(action: { controller: AbortController }): void {
    this.recoveryActionAbortControllers.delete(action.controller);
  }

  private cancelRecoveryActions(reason: string): void {
    for (const controller of this.recoveryActionAbortControllers) controller.abort(reason);
  }

  private captureSelection(target?: Pick<AppContextResult, "appBundleId" | "appName"> | null): SelectionRange | null {
    if (!isExternalTarget(target ?? undefined)) return null;
    try {
      const selection = nativeBridge.getFocusedSelection?.();
      if (!selection) return null;
      const location = Number.isFinite(selection.location) ? Math.max(0, Math.trunc(selection.location)) : NaN;
      const length = Number.isFinite(selection.length) ? Math.max(0, Math.trunc(selection.length)) : NaN;
      if (!Number.isFinite(location) || !Number.isFinite(length)) return null;
      return { location, length };
    } catch { return null; }
  }

  private isStableAutomaticTarget(
    initialTarget: AppContextResult | null,
    initialSelection: SelectionRange | null,
    initialValue: string | null,
    initialIdentity: string | null,
    target: AppContextResult,
    selection: SelectionRange | null,
    value: string | null,
    identity: string | null,
  ): boolean {
    if (!isExternalTarget(target) || !sameTarget(initialTarget, target)) return false;
    return initialIdentity !== null && identity !== null && initialIdentity === identity
      && !(initialSelection && selection && (initialSelection.location !== selection.location || initialSelection.length !== selection.length))
      && !(initialValue !== null && value !== null && initialValue !== value);
  }

  private isSameFocusedTarget(
    target: Pick<AppContextResult, "appBundleId" | "appName">,
    identity: string | null,
  ): boolean {
    if (!sameTarget(target, this.appDetector.getContext())) return false;
    const currentIdentity = safeFocusedElementIdentity();
    return identity !== null && currentIdentity !== null && currentIdentity === identity;
  }

  private matchesFocusedAX(
    target: Pick<AppContextResult, "appBundleId" | "appName">,
    baselineValue: string | null,
    baselineSelection: SelectionRange | null,
  ): boolean {
    const value = safeFocusedValue();
    const selection = this.captureSelection(target);
    return (baselineValue === null || value === null || baselineValue === value)
      && (!baselineSelection || !selection || (baselineSelection.location === selection.location && baselineSelection.length === selection.length));
  }

  private revalidateAutomaticTarget(
    initialTarget: AppContextResult | null,
    initialSelection: SelectionRange | null,
    initialValue: string | null,
    initialIdentity: string | null,
  ): { appBundleId: string | null; appName: string | null; pid?: number | null; selection: SelectionRange | null } | null {
    const target = this.appDetector.getContext();
    const selection = this.captureSelection(target);
    const value = safeFocusedValue();
    const identity = safeFocusedElementIdentity();
    if (!isExternalTarget(target) || !sameTarget(initialTarget, target)
      || (initialSelection !== null && selection !== null && (initialSelection.location !== selection.location || initialSelection.length !== selection.length))
      || (initialValue !== null && value !== null && initialValue !== value)
      || initialIdentity === null || identity === null || initialIdentity !== identity) return null;
    return { appBundleId: target.appBundleId, appName: target.appName, pid: target.pid, selection };
  }

  private setState(state: DictationState): void {
    this.state = state;
    if (state.status === "idle") {
      this.updateTrayStatus("Ready"); this.overlay.setStatusMessage?.(null); this.overlay.hide();
    } else if (state.status === "starting") {
      this.updateTrayStatus("Opening microphone…"); this.overlay.setStatusMessage?.(null); this.overlay.setPressed();
    } else if (state.status === "recording") {
      this.updateTrayStatus("Recording…"); this.overlay.setRecording();
    } else if (state.status === "finalizing") {
      this.updateTrayStatus("Processing…"); this.overlay.setProcessing();
    } else if (state.status === "transcribing") {
      this.updateTrayStatus("Transcribing…"); this.overlay.setProcessing();
    } else if (state.status === "completed") {
      this.updateTrayStatus(state.message); this.overlay.setStatusMessage?.(state.message);
      if (state.insertionOutcome === "unconfirmed" || state.insertionOutcome === "refused" || state.insertionOutcome === "failed") this.overlay.setError();
      else this.overlay.setSuccess(state.detectedLanguage);
    } else if (state.status === "error") {
      this.updateTrayStatus(state.message); this.overlay.setStatusMessage?.(state.message); this.overlay.setError();
    } else {
      this.updateTrayStatus("Error"); this.overlay.hide();
    }
    if (state.status === "idle") { this.activeSessionId = null; this.activeSessionSettings = null; this.activeTraceId = null; this.activeTarget = null; }
    this.mainWindow?.webContents.send(IpcChannel.DictationState, state);
  }

  private async startTrace(sessionId: string): Promise<void> {
    if (!this.traces) return;
    const traceId = crypto.randomUUID();
    this.activeTraceId = traceId;
    await this.safeTraceOperation("startTrace", sessionId, () => this.traces?.upsert({
      id: traceId,
      sessionId,
      startedAt: new Date().toISOString(),
      buildIdentifier: formatBuildIdentifier(getElectronAppVersion()),
      targetAppBundleId: this.activeTarget?.appBundleId ?? null,
      targetAppName: this.activeTarget?.appName ?? null,
      stages: { outcome: "started" },
      outcome: "started",
    }));
  }

  private async traceIdForSession(sessionId: string): Promise<string | null> {
    if (this.activeSessionId === sessionId && this.activeTraceId) return this.activeTraceId;
    const trace = await this.safeTraceOperation("traceIdForSession", sessionId, () => this.traces?.getBySessionId(sessionId));
    return trace?.id ?? null;
  }

  private async patchTrace(sessionId: string, patch: Partial<DictationTrace>): Promise<void> {
    if (this.activeSessionId === sessionId && this.activeTraceId) {
      await this.safeTraceOperation("patchTrace", sessionId, () => this.traces?.updateById(this.activeTraceId ?? "", (current) => mergeDictationTracePatch(current, patch)));
      return;
    }
    const trace = await this.safeTraceOperation("patchTrace:getBySessionId", sessionId, () => this.traces?.getBySessionId(sessionId));
    if (!trace) return;
    await this.safeTraceOperation("patchTrace:updateById", sessionId, () => this.traces?.updateById(trace.id, (current) => mergeDictationTracePatch(current, patch)));
  }

  private async finishTrace(
    sessionId: string,
    outcome: DictationTrace["outcome"],
    rejectionReason?: DictationRejectionReason,
    userMessage?: string,
    patch: Partial<DictationTrace> = {}
  ): Promise<void> {
    if (this.terminalTraceSessions.has(sessionId)) return;
    this.terminalTraceSessions.add(sessionId);
    if (this.terminalTraceSessions.size > 512) {
      const oldest = this.terminalTraceSessions.values().next().value;
      if (oldest) this.terminalTraceSessions.delete(oldest);
    }
    await this.patchTrace(sessionId, {
      ...patch,
      outcome,
      rejectionReason,
      userMessage,
      stages: { ...(patch.stages ?? {}), outcome },
      completedAt: new Date().toISOString(),
    });
    if (!this.traces?.getAll) return;
    const traces = await this.safeTraceOperation("evaluateInsertionAcceptance", sessionId, () => this.traces?.getAll?.());
    if (!traces) return;
    const acceptance = evaluateInsertionAcceptance(traces);
    debug("dictation", `insertion acceptance status=${acceptance.status}`, {
      status: acceptance.status,
      aggregate: acceptance.rates.aggregate,
      apps: acceptance.apps,
      unknown: acceptance.unknown,
    });
  }

  private async formatTranscriptWithTrace(rawText: string, signal?: AbortSignal, deadlineAt?: number, sessionSettings?: SessionSettingsSnapshot): Promise<FormatTranscriptTraceResult> {
    if (this.transcription.formatTranscriptDetailed) {
      return this.transcription.formatTranscriptDetailed(rawText, { signal, deadlineAt, sessionSettings });
    }
    const text = await this.transcription.formatTranscript(rawText, { signal, deadlineAt, sessionSettings });
    return { text, formatterUsed: "none" };
  }

  private async verifyInsertion(
    expectedText: string,
    baseline: string | null,
    target: Pick<AppContextResult, "appBundleId" | "appName"> | null,
    isValid: () => boolean = () => true,
  ): Promise<InsertionVerificationTrace> {
    if (!isValid()) return { readable: false, passed: false, repaired: false, reason: "not-at-target" };
    if (baseline === null) {
      return { readable: false, passed: false, repaired: false, reason: "baseline-unreadable" };
    }
    const baselineOccurrenceCount = countLiteralOccurrences(baseline, expectedText);
    const initialPoll = await this.pollInsertionValue(expectedText, baselineOccurrenceCount, target, isValid);
    if (!isValid()) return { readable: false, passed: false, repaired: false, reason: "not-at-target" };
    if (initialPoll.reason === "not-at-target") {
      return { readable: false, passed: false, repaired: false, reason: "not-at-target" };
    }

    if (initialPoll.reason === "timeout") {
      return { readable: initialPoll.value !== null, passed: false, repaired: false, reason: "timeout" };
    }

    const currentValue = initialPoll.value;
    if (currentValue === null) {
      return { readable: false, passed: false, repaired: false, reason: "unreadable" };
    }
    if (countLiteralOccurrences(currentValue, expectedText) > baselineOccurrenceCount) {
      return { readable: true, passed: true, repaired: false, reason: "expected-present" };
    }

    const insertedFragment = extractInsertedFragment(baseline, currentValue);
    return { readable: true, passed: false, repaired: false, reason: insertedFragment ? "partial-unsafe" : "missing" };
  }

  private async pollInsertionValue(
    expectedText: string,
    baselineOccurrenceCount: number,
    target: Pick<AppContextResult, "appBundleId" | "appName"> | null,
    isValid: () => boolean,
  ): Promise<{ value: string | null; reason?: "not-at-target" | "timeout" }> {
    let lastReadableValue: string | null = null;
    const deadline = this.verifierNow() + INSERTION_VERIFY_TIMEOUT_MS;
    while (true) {
      if (!isValid()) return { value: null, reason: "not-at-target" };
      if (this.verifierNow() >= deadline) break;
      if (!sameTarget(target, this.appDetector.getContext())) {
        return { value: null, reason: "not-at-target" };
      }

      const currentValue = safeFocusedValue();
      if (currentValue !== null) {
        lastReadableValue = currentValue;
        if (countLiteralOccurrences(currentValue, expectedText) > baselineOccurrenceCount) return { value: currentValue };
      }

      const remainingMs = deadline - this.verifierNow();
      if (remainingMs <= 0) break;
      await this.verifierSleep(Math.min(INSERTION_VERIFY_POLL_INTERVAL_MS, remainingMs));
    }
    if (!isValid()) return { value: null, reason: "not-at-target" };
    return { value: lastReadableValue, reason: "timeout" };
  }

  private async safeTraceOperation<T>(
    operation: string,
    sessionId: string,
    run: () => Promise<T | undefined> | undefined
  ): Promise<T | undefined> {
    try {
      return await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debug("dictation", `trace ${operation} failed for session=${sessionId}: ${message}`);
      return undefined;
    }
  }
}

function getElectronAppVersion(): string {
  return electronModule.app?.getVersion() ?? electronModule.default?.app?.getVersion() ?? "unresolved";
}

function clippedCopy(clip: { pcmData: number[]; sampleRate: number; durationSeconds: number; rmsFrames: number[] }): { pcmData: number[]; sampleRate: number; durationSeconds: number; rmsFrames: number[] } {
  return { pcmData: [...clip.pcmData], sampleRate: clip.sampleRate, durationSeconds: clip.durationSeconds, rmsFrames: [...clip.rmsFrames] };
}

function analyzeAudioQuality(clip: AudioClip, silenceThreshold: number): AudioQualityMetrics {
  const samples = clip.pcmData;
  let sumSquares = 0;
  let peakAmplitude = 0;
  let clippedSamples = 0;
  for (const sample of samples) {
    const abs = Math.abs(sample);
    peakAmplitude = Math.max(peakAmplitude, abs);
    sumSquares += sample * sample;
    if (abs >= 0.98) clippedSamples += 1;
  }
  const rmsAverage = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0;
  const rmsPeak = clip.rmsFrames.length > 0 ? Math.max(...clip.rmsFrames) : rmsAverage;
  const silentFrames = clip.rmsFrames.filter((frame) => frame < silenceThreshold).length;
  return {
    durationSeconds: clip.durationSeconds,
    sampleRate: clip.sampleRate,
    sampleCount: samples.length,
    rmsAverage,
    rmsPeak,
    peakAmplitude,
    clippingRatio: samples.length > 0 ? clippedSamples / samples.length : 0,
    silenceRatio: clip.rmsFrames.length > 0 ? silentFrames / clip.rmsFrames.length : 1,
  };
}

function isExternalTarget(context: Pick<AppContextResult, "appBundleId" | "appName"> | null | undefined): context is Pick<AppContextResult, "appBundleId" | "appName"> {
  if (!context) return false;
  const bundleId = context.appBundleId?.trim().toLowerCase() ?? "";
  const appName = context.appName?.trim().toLowerCase() ?? "";
  if (!bundleId && !appName) return false;
  const internalBundleIds = new Set(["com.claudevaani.app"]);
  return !internalBundleIds.has(bundleId) && !new Set(["claude vaani", "vaani", "electron"]).has(appName);
}

function sameTarget(left: Pick<AppContextResult, "appBundleId" | "appName" | "pid"> | null | undefined, right: Pick<AppContextResult, "appBundleId" | "appName" | "pid"> | null | undefined): boolean {
  const leftPid = left?.pid;
  const rightPid = right?.pid;
  if (typeof leftPid === "number" && leftPid !== rightPid) return false;
  const leftBundleId = left?.appBundleId?.trim().toLowerCase() ?? "";
  const rightBundleId = right?.appBundleId?.trim().toLowerCase() ?? "";
  if (leftBundleId && rightBundleId) return leftBundleId === rightBundleId;
  const leftAppName = left?.appName?.trim().toLowerCase() ?? "";
  const rightAppName = right?.appName?.trim().toLowerCase() ?? "";
  return !!leftAppName && leftAppName === rightAppName;
}

const OUTCOME_UNCERTAIN_DETAIL = "outcome_uncertain";

// Short warning added to the insert message when formatting did not apply.
function formatNoticeFor(trace: FormatTranscriptTraceResult): string | null {
  return trace.formatterStatus === "failed" || trace.formatterStatus === "rejected"
    ? "Formatting did not apply. Inserted the unformatted text."
    : null;
}

function insertionStatusText(outcome: DictationInsertionOutcome, historySaved: boolean, stage: string, copied = false): string {
  switch (outcome) {
    case "verified": return "Inserted.";
    case "unconfirmed": return "Insertion unconfirmed. Check the field before pasting again.";
    case "refused": return "Not inserted: target changed.";
    case "copy-only": return "Copied. Paste when ready.";
    case "failed": return `${stage} failed. ${historySaved ? "Find this session in History." : copied ? "Text is on the clipboard." : "Text was not saved."}`;
  }
}

function activeInsertionFailureDetail(reason: InjectionFailureReason): string {
  if (reason === "target_changed") return "stale_target";
  if (reason === "outcome_uncertain") return OUTCOME_UNCERTAIN_DETAIL;
  return "insertion_failed";
}

// An insertion that may already have reached the target must not be re-typed
// automatically; the user can still copy the text explicitly.
function isUnresolvedInsertion(insertion: RecoveryEntry["insertion"]): boolean {
  if (!insertion) return false;
  return insertion.outcome === "pending" || insertion.detail === OUTCOME_UNCERTAIN_DETAIL;
}

function messageForInjectionFailure(reason: InjectionFailureReason): string {
  switch (reason) {
    case "permission_missing": return "Accessibility permission is missing for text insertion.";
    case "no_editable_target": return "No editable text field is focused.";
    case "target_changed": return "Not inserted: target changed.";
    case "outcome_uncertain": return "Insertion may already have happened. Use Copy to recover the text.";
    default: return "Could not paste the latest dictation.";
  }
}

function mapProviderAttempt(attempt: ProviderAttemptTrace): RecoveryEntry["providerAttempts"][number] {
  const completedAt = new Date().toISOString();
  const latencyMs = typeof attempt.latencyMs === "number" && Number.isFinite(attempt.latencyMs) ? attempt.latencyMs : 0;
  return {
    attempt: attempt.attempt ?? attempt.quality?.attemptCount ?? 1,
    provider: attempt.provider,
    startedAt: attempt.startedAt ?? new Date(Date.now() - Math.max(0, latencyMs)).toISOString(),
    completedAt: attempt.completedAt ?? completedAt,
    deadlineAt: attempt.deadlineAt ?? null,
    outcome: attempt.outcome ?? (attempt.success ? "succeeded" : "failed"),
    ...(attempt.error ? { error: { class: attempt.errorClass ?? "transcription_error", detail: attempt.error } } : {}),
  };
}

export function selectRecoveryText(text: RecoveryTextReferences): string | null {
  return text.formattedText ?? text.cleanedText ?? text.rawTranscript;
}

function recoveryErrorClass(reason: DictationRejectionReason): RecoveryErrorClass {
  switch (reason) {
    case "microphone_permission_denied": return "microphone_permission_denied";
    case "no_speech": return "no_speech";
    case "timeout": return "timeout";
    case "stale-session": return "timeout";
    case "recorder_failure": return "recorder_failure";
    case "insertion_failed": return "insertion_failed";
    case "cancelled": return "interrupted";
    case "recorder_unavailable": return "recorder_failure";
    case "fragment": return "transcription_error";
    case "transcription_error": return "transcription_error";
  }
}

function safeFocusedValue(): string | null {
  try {
    return nativeBridge.getFocusedValue?.() ?? null;
  } catch {
    return null;
  }
}

function safeFocusedElementIdentity(): string | null {
  try {
    return nativeBridge.getFocusedElementIdentity?.() ?? null;
  } catch {
    return null;
  }
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 500);
}

function countLiteralOccurrences(value: string, expectedText: string): number {
  if (expectedText.length === 0) return 0;
  let count = 0;
  let searchFrom = 0;
  while (true) {
    const index = value.indexOf(expectedText, searchFrom);
    if (index === -1) return count;
    count += 1;
    searchFrom = index + expectedText.length;
  }
}

function delay(ms: number): Promise<void> {
  if (process.env.NODE_ENV === "test") return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRecoveryWav(bytes: Buffer): AudioClip {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Recovery audio is not a supported WAV file.");
  }
  const channels = bytes.readUInt16LE(22);
  const sampleRate = bytes.readUInt32LE(24);
  const bitsPerSample = bytes.readUInt16LE(34);
  const dataOffset = bytes.indexOf(Buffer.from("data"), 36);
  if (channels !== 1 || bitsPerSample !== 16 || sampleRate < 8_000 || sampleRate > 192_000 || dataOffset < 0 || dataOffset + 8 > bytes.length) {
    throw new Error("Recovery audio format is unsupported.");
  }
  const dataLength = Math.min(bytes.readUInt32LE(dataOffset + 4), bytes.length - dataOffset - 8);
  if (dataLength <= 0 || dataLength % 2 !== 0) throw new Error("Recovery audio has no samples.");
  const pcmData = new Array<number>(dataLength / 2);
  for (let index = 0; index < pcmData.length; index += 1) {
    pcmData[index] = bytes.readInt16LE(dataOffset + 8 + index * 2) / 32_768;
  }
  return {
    pcmData,
    sampleRate,
    durationSeconds: pcmData.length / sampleRate,
    rmsFrames: [],
  };
}

function extractInsertedFragment(initialValue: string | null, currentValue: string): string | null {
  if (initialValue === null) return null;
  if (currentValue === initialValue) return "";
  let prefixLength = 0;
  while (
    prefixLength < initialValue.length &&
    prefixLength < currentValue.length &&
    initialValue[prefixLength] === currentValue[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < initialValue.length - prefixLength &&
    suffixLength < currentValue.length - prefixLength &&
    initialValue[initialValue.length - 1 - suffixLength] === currentValue[currentValue.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const end = suffixLength === 0 ? currentValue.length : currentValue.length - suffixLength;
  return currentValue.slice(prefixLength, end);
}

function extractCorrectedInsertedText(initialValue: string | null, currentValue: string, insertedText: string): string | null {
  if (!initialValue) return null;
  const insertedAt = initialValue.indexOf(insertedText);
  if (insertedAt < 0) return currentValue.trim() || null;

  const prefix = initialValue.slice(0, insertedAt);
  const suffix = initialValue.slice(insertedAt + insertedText.length);
  if (!currentValue.startsWith(prefix) || !currentValue.endsWith(suffix)) {
    return null;
  }

  const end = suffix.length === 0 ? currentValue.length : currentValue.length - suffix.length;
  const corrected = currentValue.slice(prefix.length, end).trim();
  return corrected || null;
}

function shouldSuggestSnippet(originalText: string, correctedText: string): boolean {
  if (!isSnippetLikeContent(correctedText)) return false;
  if (wordCount(originalText) > 4) return false;
  return correctedText.length >= 8;
}

function isSnippetLikeContent(text: string): boolean {
  return EMAIL_PATTERN.test(text)
    || URL_PATTERN.test(text)
    || PHONE_PATTERN.test(text)
    || ADDRESS_PATTERN.test(text);
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+\b/i;
const PHONE_PATTERN = /\b(?:\+?\d[\d\s().-]{7,}\d)\b/;
const ADDRESS_PATTERN = /\b\d{1,6}\s+[A-Za-z0-9 .'-]+\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd)\b/i;

function buildSnippetTrigger(content: string, existing: Array<{ trigger: string }>): string {
  const base = content
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join("-");
  const fallback = base || "snippet";
  const taken = new Set(existing.map((snippet) => snippet.trigger.toLowerCase()));
  if (!taken.has(fallback)) return fallback;

  let suffix = 2;
  while (taken.has(`${fallback}-${suffix}`)) {
    suffix += 1;
  }
  return `${fallback}-${suffix}`;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function resolveAppProfile(appProfiles: NonNullable<Settings["appProfiles"]>, bundleId: string | null): NonNullable<Settings["appProfiles"]>[number] | null {
  if (!bundleId || appProfiles.length === 0) return null;
  const id = bundleId.toLowerCase();
  return appProfiles.find(p => p.appBundleIds.some(b => b.toLowerCase() === id)) ?? null;
}

function resolveSnippetPlaceholder(name: "date" | "time" | "clipboard"): string {
  const now = new Date();
  if (name === "date") return now.toLocaleDateString();
  if (name === "time") return now.toLocaleTimeString();
  const { clipboard } = createRequire(import.meta.url)("electron") as typeof import("electron");
  return clipboard.readText();
}
