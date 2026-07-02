import { BrowserWindow } from "electron";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DictionarySuggestion } from "@shared/dictionarySuggestions";
import type {
  AudioClip,
  AudioQualityMetrics,
  AudioVisualFrame,
  DictationCompletionOutcome,
  DictationEntry,
  DictationRejectionReason,
  DictationState,
  DictationTrace,
  DictationBugReport,
  InjectionFailureReason,
  RecorderFailure,
  RecorderSubmission,
  SelectionRange,
  Settings,
  TranscriptionResult
} from "@shared/types";
import { ERROR_RESET_MS, SUCCESS_RESET_MS } from "@shared/defaults";
import { IpcChannel } from "@shared/ipc";
import { trimSilence, isValidClip } from "./audio/vad";
import { AppDetector, type AppContextResult } from "./context/appDetector";
import { TextInjector } from "./injection";
import { nativeBridge } from "./nativeBridge";
import { debug } from "@main/log";
import { OverlayController } from "./overlay";
import { HistoryStore } from "./store/history";
import { DictationTraceStore } from "./store/dictationTrace";
import { SettingsStore } from "./store/settings";
import { CredentialsStore } from "./store/credentials";
import { cleanupText } from "./text/cleanup";
import { detectDictionarySuggestions } from "@shared/dictionarySuggestions";
import { TranscriptionService, type FormatTranscriptTraceResult } from "./transcription";
import { SessionTimers } from "./dictation/sessionTimers";
import { decideTranscriptInsertion, finalizeTranscriptDecision } from "./transcriptQuality";
import { mergeDictationTracePatch } from "./dictationTraceSnapshot";

const FINALIZATION_TIMEOUT_MS = 4_000;
const TRANSCRIPTION_TIMEOUT_MS = 30_000;
const FORMATTING_TIMEOUT_MS = 20_000;
const AUDIO_FRAME_TIMEOUT_MS = 1_600;
const RECORDER_START_TIMEOUT_MS = 5_000;
const STALE_SESSION_TIMEOUT_MS = 60_000;
const UPTIME_LOG_INTERVAL_MS = 3_600_000;
const EDIT_WATCH_INTERVAL_MS = 500;
const EDIT_WATCH_TIMEOUT_MS = 12_000;
const EDIT_PROMPT_IDLE_MS = 1_000;

interface RecorderCommands {
  isReady: () => boolean;
  startRecording: (sessionId: string) => boolean;
  stopRecording: (sessionId: string) => boolean;
}

interface DictationServiceDeps {
  transcription?: Pick<TranscriptionService, "transcribe" | "formatTranscript"> & Partial<Pick<TranscriptionService, "formatTranscriptDetailed">>;
  injector?: Pick<TextInjector, "inject">;
  appDetector?: Pick<AppDetector, "getContext">;
  recorder?: RecorderCommands;
  credentials?: CredentialsStore;
  createSessionId?: () => string;
  traces?: Pick<DictationTraceStore, "upsert" | "updateById" | "getById" | "getBySessionId">;
}

export class DictationService {
  private state: DictationState = { status: "idle" };
  private readonly transcription: Pick<TranscriptionService, "transcribe" | "formatTranscript"> & Partial<Pick<TranscriptionService, "formatTranscriptDetailed">>;
  private readonly injector: Pick<TextInjector, "inject">;
  private readonly appDetector: Pick<AppDetector, "getContext">;
  private readonly createSessionId: () => string;
  private readonly traces: Pick<DictationTraceStore, "upsert" | "updateById" | "getById" | "getBySessionId"> | null;
  private readonly timers = new SessionTimers();
  private pendingEditPromptKey: string | null = null;
  private pendingEdit: { insertedText: string; correctedCandidate: string } | null = null;
  private activeSessionId: string | null = null;
  private activeTraceId: string | null = null;
  private activeTarget: AppContextResult | null = null;
  private activeSelection: SelectionRange | null = null;
  private releaseRequestedDuringStart = false;
  private readonly recorder: RecorderCommands | null;
  private pasteLatestInProgress = false;

  constructor(
    private readonly mainWindow: BrowserWindow | null,
    private readonly settings: SettingsStore,
    private readonly history: HistoryStore,
    private readonly updateTrayStatus: (label: string) => void,
    private readonly overlay: OverlayController,
    deps: DictationServiceDeps = {}
  ) {
    this.transcription = deps.transcription ?? new TranscriptionService(() => this.settings.get(), deps.credentials);
    this.injector = deps.injector ?? new TextInjector(() => this.settings.get());
    this.appDetector = deps.appDetector ?? new AppDetector();
    this.recorder = deps.recorder ?? null;
    this.createSessionId = deps.createSessionId ?? (() => crypto.randomUUID());
    this.traces = deps.traces ?? null;
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
      if (this.isCurrentSession(sessionId) && this.state.status !== "idle") {
        debug("dictation", `stale session guard fired: status=${this.state.status}, forcing reset`);
        this.resetToIdle();
      }
    }, STALE_SESSION_TIMEOUT_MS);
  }

  private rearmStaleSessionGuard(): void {
    if (this.activeSessionId) {
      this.armStaleSessionGuard(this.activeSessionId);
    }
  }

  beginHotkeySession(): void {
    if (this.state.status !== "idle") {
      if (this.state.status === "completed" || this.state.status === "error") {
        this.resetToIdle();
      } else if (this.state.status === "transcribing") {
        this.resetToIdle();
      } else {
        return;
      }
    }

    this.clearTimers();

    this.discardPendingEdit("new-dictation");
    this.clearEditWatch();

    const sessionId = this.createSessionId();
    this.activeSessionId = sessionId;
    this.activeTarget = this.appDetector.getContext();
    this.activeSelection = this.captureSelection(this.activeTarget);
    void this.startTrace(sessionId);
    this.releaseRequestedDuringStart = false;
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
    if (this.activeSessionId) void this.finishTrace(this.activeSessionId, "cancelled", "cancelled", "Dictation cancelled.");
    this.clearEditWatch();
    this.resetToIdle();
  }

  endHotkeySession(): void {
    if (this.state.status === "starting") {
      this.releaseRequestedDuringStart = true;
      return;
    }

    if (this.state.status !== "recording") {
      return;
    }

    const { sessionId } = this.state;
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
    void this.patchTrace(sessionId, { hotkeyReleasedAt: new Date().toISOString() });
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
      const minRecordMs = Math.max(this.settings.get().minClipDuration * 1000 + 250, 750);
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
    const settings = this.settings.get();
    const trimmedClip = trimSilence(payload.clip, settings.silenceThreshold);
    const tracePatch: Partial<DictationTrace> = {
      rawAudio: analyzeAudioQuality(payload.clip, settings.silenceThreshold),
      trimmedAudio: analyzeAudioQuality(trimmedClip, settings.silenceThreshold),
    };

    debug("dictation", `submitAudioClip: raw=${payload.clip.durationSeconds.toFixed(2)}s, trimmed=${trimmedClip.durationSeconds.toFixed(2)}s, minClip=${settings.minClipDuration}s`);

    // Save recording to disk if enabled
    let rawAudioPath: string | null = null;
    if (settings.saveRecordings) {
      rawAudioPath = await this.saveRecordingToDisk(clippedCopy(payload.clip));
      tracePatch.rawAudioPath = rawAudioPath;
    }
    void this.patchTrace(payload.sessionId, tracePatch);

    if (!isValidClip(trimmedClip, settings.minClipDuration)) {
      debug("dictation", "submitAudioClip: clip rejected (too short or empty)");
      this.failSession(payload.sessionId, "No speech detected. Try speaking louder or closer to the microphone.", "no_speech");
      return;
    }

    this.setState({ status: "transcribing", sessionId: payload.sessionId });

    try {
      const appProfile = resolveAppProfile(settings.appProfiles ?? [], this.activeTarget?.appBundleId ?? null);
      let transcriptionTimer: ReturnType<typeof setTimeout> | null = null;
      const sttStartedAt = Date.now();
      const transcription = await Promise.race([
        this.transcription.transcribe(trimmedClip, {
          ...(appProfile?.language ? { languageOverride: appProfile.language } : {}),
          ...(appProfile?.transcriptionProvider ? { providerOverride: appProfile.transcriptionProvider } : {}),
          rejectResult: (result: TranscriptionResult) => decideTranscriptInsertion(result.rawText, trimmedClip, result.quality).action === "retry",
        }).finally(() => { if (transcriptionTimer) { clearTimeout(transcriptionTimer); transcriptionTimer = null; } }),
        new Promise<never>((_, reject) => { transcriptionTimer = setTimeout(() => reject(new Error("Transcription timed out. Please try again.")), TRANSCRIPTION_TIMEOUT_MS); }),
      ]);
      const qualityDecision = finalizeTranscriptDecision(decideTranscriptInsertion(transcription.rawText, trimmedClip, transcription.quality));
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
        const cleanedText = cleanupText({ rawText: transcription.rawText, settings, trace: cleanupTrace });
        void this.patchTrace(payload.sessionId, {
          stages: {
            cleanedText,
            formatterUsed: "none",
            correctionsApplied: cleanupTrace.correctionsApplied,
            injectionStrategy: "none",
          },
        });
        await this.history.append({
          id: crypto.randomUUID(),
          traceId: await this.traceIdForSession(payload.sessionId),
          timestamp: new Date().toISOString(),
          rawText: transcription.rawText,
          formattedText: transcription.rawText,
          cleanedText,
          durationSeconds: trimmedClip.durationSeconds,
          appBundleId: this.activeTarget?.appBundleId ?? null,
          appName: this.activeTarget?.appName ?? null,
          injectionStatus: "saved",
          injectionMethod: null,
          language: transcription.language,
          detectedLanguage: transcription.detectedLanguage ?? null,
          rawAudioPath,
        });
        void this.finishTrace(payload.sessionId, "saved", "fragment", "Saved to history", { injectionMethod: null });
        this.completeSession(payload.sessionId, "saved", cleanedText, "Saved to history", transcription.detectedLanguage);
        return;
      }

      // Format via LLM using provider system
      let formattedText = transcription.rawText;
      let formatTrace: FormatTranscriptTraceResult = { text: transcription.rawText, formatterUsed: "none" };
      try {
        let formattingTimer: ReturnType<typeof setTimeout> | null = null;
        const formattingStartedAt = Date.now();
        formatTrace = await Promise.race([
          this.formatTranscriptWithTrace(transcription.rawText).finally(() => { if (formattingTimer) { clearTimeout(formattingTimer); formattingTimer = null; } }),
          new Promise<never>((_, reject) => { formattingTimer = setTimeout(() => reject(new Error("Formatting timed out.")), FORMATTING_TIMEOUT_MS); }),
        ]);
        formattedText = formatTrace.text;
        void this.patchTrace(payload.sessionId, { formattingLatencyMs: Date.now() - formattingStartedAt });
      } catch {
        formattedText = transcription.rawText;
        formatTrace = { text: transcription.rawText, formatterUsed: "none" };
      }

      const textForCleanup = formattedText !== transcription.rawText ? formattedText : transcription.rawText;
      const cleanupTrace = { correctionsApplied: [] };
      const cleanedText = cleanupText({ rawText: textForCleanup, settings, trace: cleanupTrace });
      void this.patchTrace(payload.sessionId, {
        stages: {
          cleanedText,
          formatterUsed: formatTrace.formatterUsed,
          contentGuardVerdict: formatTrace.contentGuardVerdict,
          correctionsApplied: cleanupTrace.correctionsApplied,
        },
      });
      if (!this.isCurrentSession(payload.sessionId)) {
        void this.finishTrace(payload.sessionId, "cancelled", "cancelled", "Dictation superseded by a newer session.");
        return;
      }
      const freshTarget = this.appDetector.getContext();
      const target = isExternalTarget(this.activeTarget) ? this.activeTarget : freshTarget;
      this.activeTarget = target;
      this.activeSelection = this.captureSelection(target);
      const entryBase: Omit<DictationEntry, "injectionStatus" | "injectionMethod"> = {
        id: crypto.randomUUID(),
        traceId: await this.traceIdForSession(payload.sessionId),
        timestamp: new Date().toISOString(),
        rawText: transcription.rawText,
        formattedText,
        cleanedText,
        durationSeconds: trimmedClip.durationSeconds,
        appBundleId: target.appBundleId,
        appName: target.appName,
        language: transcription.language,
        detectedLanguage: transcription.detectedLanguage ?? null,
        rawAudioPath,
      };

      const injectionTarget = {
        appBundleId: target.appBundleId,
        appName: target.appName,
        selection: this.activeSelection
      };

      let injection = await this.injector.inject(cleanedText, injectionTarget);
      const injectionAttempts: DictationTrace["injectionAttempts"] = [{
        targetAppBundleId: injectionTarget.appBundleId,
        targetAppName: injectionTarget.appName,
        method: injection.success ? injection.method : null,
        success: injection.success,
      }];
      if (!injection.success) {
        const fallbackTarget = this.appDetector.getContext();
        if (isExternalTarget(fallbackTarget) && !sameTarget(injectionTarget, fallbackTarget)) {
          injection = await this.injector.inject(cleanedText, {
            appBundleId: fallbackTarget.appBundleId,
            appName: fallbackTarget.appName,
            selection: this.captureSelection(fallbackTarget)
          });
          injectionAttempts.push({
            targetAppBundleId: fallbackTarget.appBundleId,
            targetAppName: fallbackTarget.appName,
            method: injection.success ? injection.method : null,
            success: injection.success,
            fallbackReason: "primary-insertion-failed",
          });
          if (injection.success) this.activeTarget = fallbackTarget;
        }
      }
      void this.patchTrace(payload.sessionId, { injectionAttempts });
      if (!this.isCurrentSession(payload.sessionId)) return;

      if (injection.success) {
        await this.history.append({ ...entryBase, injectionStatus: "injected", injectionMethod: injection.method });
        void this.finishTrace(payload.sessionId, "injected", undefined, "Inserted at cursor", {
          injectionMethod: injection.method,
          stages: { injectedText: cleanedText, injectionStrategy: injection.method },
        });
        this.completeSession(payload.sessionId, "injected", cleanedText, "Inserted at cursor", transcription.detectedLanguage);
        debug("editwatch", "arming", { method: injection.method, appBundleId: target.appBundleId, appName: target.appName });
        this.watchForManualEdits(cleanedText, target);
      } else {
        debug("editwatch", "not-armed-injection-saved", { appBundleId: target.appBundleId, appName: target.appName });
        await this.history.append({ ...entryBase, injectionStatus: "saved", injectionMethod: null });
        void this.finishTrace(payload.sessionId, "saved", "insertion_failed", "Saved to history", {
          injectionMethod: null,
          stages: { injectedText: cleanedText, injectionStrategy: "none" },
        });
        this.completeSession(payload.sessionId, "saved", cleanedText, "Saved to history", transcription.detectedLanguage);
      }
    } catch (error) {
      if (!this.isCurrentSession(payload.sessionId)) return;
      const message = error instanceof Error ? error.message : "Dictation failed.";
      this.failSession(payload.sessionId, message, message.toLowerCase().includes("timed out") ? "timeout" : "transcription_error");
    }
  }

  reportRecorderReady(): void {}

  handleRecorderFailure(payload: RecorderFailure): void {
    if (!this.isCurrentSession(payload.sessionId)) return;
    this.failSession(payload.sessionId, payload.message, "recorder_failure");
  }

  reportHotkeyUnavailable(message: string): void {
    this.clearTimers();
    this.activeSessionId = null;
    this.activeTraceId = null;
    this.activeTarget = null;
    this.activeSelection = null;
    this.setState({ status: "error", sessionId: null, message });
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
    const entry = await this.history.getById(id);
    if (!entry) return;
    const result = await this.injector.inject(entry.cleanedText, this.currentInjectionTarget(entry));
    if (!result.success) {
      this.setState({ status: "error", sessionId: null, message: messageForInjectionFailure(result.reason) });
      this.scheduleReset(ERROR_RESET_MS);
      return;
    }
    const sessionId = this.createSessionId();
    this.setState({ status: "completed", sessionId, outcome: "injected", text: entry.cleanedText, message: "Inserted at cursor" });
    this.scheduleReset(SUCCESS_RESET_MS);
  }

  async retryEntry(id: string): Promise<void> {
    const entry = await this.history.getById(id);
    if (!entry) return;
    const result = await this.injector.inject(entry.cleanedText, this.currentInjectionTarget(entry));
    if (!result.success) {
      this.setState({ status: "error", sessionId: null, message: messageForInjectionFailure(result.reason) });
      this.scheduleReset(ERROR_RESET_MS);
      return;
    }
    await this.history.updateById(id, (current) => ({
      ...current,
      injectionStatus: "injected",
      injectionMethod: result.method,
    }));
    if (entry.traceId) {
      void this.safeTraceOperation("retryEntry", entry.traceId, () =>
        this.traces?.updateById(entry.traceId ?? "", (trace) => ({
          ...trace,
          outcome: "injected",
          injectionMethod: result.method,
          rejectionReason: undefined,
          userMessage: "Retry inserted at cursor",
          completedAt: new Date().toISOString(),
        }))
      );
    }
    const sessionId = this.createSessionId();
    this.setState({ status: "completed", sessionId, outcome: "injected", text: entry.cleanedText, message: "Retry inserted at cursor" });
    this.scheduleReset(SUCCESS_RESET_MS);
  }

  async getTrace(traceId: string): Promise<DictationTrace | undefined> {
    return this.traces?.getById(traceId);
  }

  async exportBugReport(entryId: string, appVersion?: string): Promise<DictationBugReport> {
    const entry = await this.history.getById(entryId) ?? null;
    const trace = entry?.traceId ? await this.safeTraceOperation("exportBugReport", entry.traceId, () => this.traces?.getById(entry.traceId ?? "")) ?? null : null;
    return {
      entry: redactEntryForBugReport(entry),
      trace: redactTraceForBugReport(trace),
      generatedAt: new Date().toISOString(),
      appVersion,
    };
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
      const result = await this.injector.inject(latest.cleanedText, this.currentInjectionTarget(latest));
      if (!result.success) {
        this.setState({ status: "error", sessionId: null, message: messageForInjectionFailure(result.reason) });
        this.scheduleReset(ERROR_RESET_MS);
        return;
      }
      const sessionId = this.createSessionId();
      this.setState({ status: "completed", sessionId, outcome: "injected", text: latest.cleanedText, message: "Inserted at cursor" });
      this.scheduleReset(SUCCESS_RESET_MS);
    } finally {
      this.pasteLatestInProgress = false;
    }
  }

  getState(): DictationState { return this.state; }

  async demoTranscribe(clip: { pcmData: number[]; sampleRate: number; durationSeconds: number; rmsFrames: number[] }): Promise<string> {
    let demoTimer: ReturnType<typeof setTimeout> | null = null;
    const result = await Promise.race([
      this.transcription.transcribe(clip).then(r => { if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; } return r; }),
      new Promise<never>((_, reject) => { demoTimer = setTimeout(() => reject(new Error("Transcription timed out. Please try again.")), TRANSCRIPTION_TIMEOUT_MS); }),
    ]);
    return result.rawText;
  }

  async getById(id: string): Promise<DictationEntry | undefined> {
    return this.history.getById(id);
  }

  async showDictionarySuggestions(suggestions: DictionarySuggestion[]): Promise<void> {
    for (const suggestion of suggestions) {
      const accepted = await new Promise<boolean>((resolve) => {
        this.overlay.showDictionaryPrompt(suggestion.spoken, suggestion.written, resolve);
      });
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

  private async saveRecordingToDisk(clip: { pcmData: number[]; sampleRate: number; durationSeconds: number; rmsFrames: number[] }): Promise<string | null> {
    try {
      const settings = this.settings.get();
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
      await writeFile(filepath, buf);
      return filepath;
    } catch {
      // Best-effort saving
      return null;
    }
  }

  private currentInjectionTarget(entry: Pick<DictationEntry, "appBundleId" | "appName">) {
    const current = this.appDetector.getContext();
    if (isExternalTarget(current)) {
      return { appBundleId: current.appBundleId, appName: current.appName, selection: this.captureSelection(current) };
    }
    return { appBundleId: entry.appBundleId, appName: entry.appName, selection: null };
  }

  // Applies the rule and returns an undo closure (restores the prior entry, or
  // removes the newly added one). Returns null if the suggestion is unusable.
  private applyDictionarySuggestion(suggestion: DictionarySuggestion): (() => void) | null {
    const spoken = suggestion.spoken.trim();
    const written = suggestion.written.trim();
    if (!spoken || !written) return null;
    const current = this.settings.get().customCorrections ?? [];
    const existingIndex = current.findIndex((entry) => entry.spoken.toLowerCase() === spoken.toLowerCase());
    const previousEntry = existingIndex >= 0 ? current[existingIndex] : null;
    const nextCorrections = existingIndex >= 0
      ? current.map((entry, index) => index === existingIndex ? { ...entry, spoken, written, source: "auto-suggested" as const } : entry)
      : [...current, { spoken, written, source: "auto-suggested" as const }];
    this.settings.update({ customCorrections: nextCorrections });

    return () => {
      const now = this.settings.get().customCorrections ?? [];
      const index = now.findIndex((entry) => entry.spoken.toLowerCase() === spoken.toLowerCase());
      if (index < 0) return;
      const reverted = previousEntry
        ? now.map((entry, i) => i === index ? previousEntry : entry)
        : now.filter((_, i) => i !== index);
      this.settings.update({ customCorrections: reverted });
    };
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
        baseline = currentValue;
        debug("editwatch", "baseline-recovered");
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

  private completeSession(sessionId: string, outcome: DictationCompletionOutcome, text: string, message: string, detectedLanguage?: string | null): void {
    if (!this.isCurrentSession(sessionId)) return;
    this.clearAudioFrameTimer();
    this.setState({ status: "completed", sessionId, outcome, text, message, detectedLanguage });
    this.scheduleReset(SUCCESS_RESET_MS);
  }

  private failSession(sessionId: string, message: string, reason: DictationRejectionReason = "transcription_error"): void {
    if (!this.isCurrentSession(sessionId)) return;
    this.clearRecorderStartTimer();
    this.clearAudioFrameTimer();
    this.clearFinalizationTimer();
    this.setState({ status: "error", sessionId, message });
    void this.finishTrace(sessionId, reason === "no_speech" || reason === "fragment" ? "rejected" : "failed", reason, message);
    this.scheduleReset(ERROR_RESET_MS);
  }

  private resetToIdle(): void {
    this.clearTimers();
    this.activeSessionId = null;
    this.activeTarget = null;
    this.activeSelection = null;
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
    this.clearResetTimer();
    this.clearFinalizationTimer();
    this.clearAudioFrameTimer();
    this.clearRecorderStartTimer();
    this.clearStaleSessionTimer();
    this.clearEditWatch();
    this.clearUptimeLogging();
  }

  private isCurrentSession(sessionId: string): boolean { return this.activeSessionId === sessionId; }

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

  private setState(state: DictationState): void {
    this.state = state;
    if (state.status === "idle") {
      this.updateTrayStatus("Ready"); this.overlay.hide();
    } else if (state.status === "starting") {
      this.updateTrayStatus("Opening microphone…"); this.overlay.setPressed();
    } else if (state.status === "recording") {
      this.updateTrayStatus("Recording…"); this.overlay.setRecording();
    } else if (state.status === "finalizing") {
      this.updateTrayStatus("Processing…"); this.overlay.setProcessing();
    } else if (state.status === "transcribing") {
      this.updateTrayStatus("Transcribing…"); this.overlay.setProcessing();
    } else if (state.status === "completed") {
      this.updateTrayStatus(state.outcome === "saved" ? "Saved" : "Done"); this.overlay.setSuccess(state.detectedLanguage);
    } else if (state.status === "error") {
      this.updateTrayStatus("Error"); this.overlay.setError();
    } else {
      this.updateTrayStatus("Error"); this.overlay.hide();
    }
    if (state.status === "idle") { this.activeSessionId = null; this.activeTraceId = null; this.activeTarget = null; }
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
    await this.patchTrace(sessionId, {
      ...patch,
      outcome,
      rejectionReason,
      userMessage,
      stages: { ...(patch.stages ?? {}), outcome },
      completedAt: new Date().toISOString(),
    });
  }

  private async formatTranscriptWithTrace(rawText: string): Promise<FormatTranscriptTraceResult> {
    if (this.transcription.formatTranscriptDetailed) {
      return this.transcription.formatTranscriptDetailed(rawText);
    }
    const text = await this.transcription.formatTranscript(rawText);
    return {
      text,
      formatterUsed: text === rawText ? "none" : "llm",
    };
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

function redactEntryForBugReport(entry: DictationEntry | null): DictationEntry | null {
  return entry ? { ...entry, rawAudioPath: entry.rawAudioPath ? null : entry.rawAudioPath } : null;
}

function redactTraceForBugReport(trace: DictationTrace | null): DictationTrace | null {
  return trace ? { ...trace, rawAudioPath: trace.rawAudioPath ? null : trace.rawAudioPath } : null;
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

function sameTarget(left: Pick<AppContextResult, "appBundleId" | "appName"> | null | undefined, right: Pick<AppContextResult, "appBundleId" | "appName"> | null | undefined): boolean {
  const leftBundleId = left?.appBundleId?.trim().toLowerCase() ?? "";
  const rightBundleId = right?.appBundleId?.trim().toLowerCase() ?? "";
  if (leftBundleId && rightBundleId) return leftBundleId === rightBundleId;
  const leftAppName = left?.appName?.trim().toLowerCase() ?? "";
  const rightAppName = right?.appName?.trim().toLowerCase() ?? "";
  return !!leftAppName && leftAppName === rightAppName;
}

function messageForInjectionFailure(reason: InjectionFailureReason): string {
  switch (reason) {
    case "permission_missing": return "Accessibility permission is missing for text insertion.";
    case "no_editable_target": return "No editable text field is focused.";
    default: return "Could not paste the latest dictation.";
  }
}

function safeFocusedValue(): string | null {
  try {
    return nativeBridge.getFocusedValue?.() ?? null;
  } catch {
    return null;
  }
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
