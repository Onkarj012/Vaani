import { BrowserWindow } from "electron";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DictionarySuggestion } from "@shared/dictionarySuggestions";
import type {
  AudioVisualFrame,
  DictationCompletionOutcome,
  DictationEntry,
  DictationState,
  InjectionFailureReason,
  RecorderFailure,
  RecorderSubmission,
  SelectionRange
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
import { SettingsStore } from "./store/settings";
import { CredentialsStore } from "./store/credentials";
import { cleanupText } from "./text/cleanup";
import { detectDictionarySuggestions } from "@shared/dictionarySuggestions";
import { TranscriptionService } from "./transcription";
import { SessionTimers } from "./dictation/sessionTimers";

const FINALIZATION_TIMEOUT_MS = 4_000;
const TRANSCRIPTION_TIMEOUT_MS = 30_000;
const FORMATTING_TIMEOUT_MS = 20_000;
const AUDIO_FRAME_TIMEOUT_MS = 1_600;
const RECORDER_START_TIMEOUT_MS = 5_000;
const STALE_SESSION_TIMEOUT_MS = 60_000;
const UPTIME_LOG_INTERVAL_MS = 3_600_000;
const EDIT_WATCH_INTERVAL_MS = 500;
const EDIT_WATCH_TIMEOUT_MS = 12_000;
const EDIT_PROMPT_IDLE_MS = 2_000;

interface RecorderCommands {
  isReady: () => boolean;
  startRecording: (sessionId: string) => boolean;
  stopRecording: (sessionId: string) => boolean;
}

interface DictationServiceDeps {
  transcription?: Pick<TranscriptionService, "transcribe" | "formatTranscript">;
  injector?: Pick<TextInjector, "inject">;
  appDetector?: Pick<AppDetector, "getContext">;
  recorder?: RecorderCommands;
  credentials?: CredentialsStore;
  createSessionId?: () => string;
}

export class DictationService {
  private state: DictationState = { status: "idle" };
  private readonly transcription: Pick<TranscriptionService, "transcribe" | "formatTranscript">;
  private readonly injector: Pick<TextInjector, "inject">;
  private readonly appDetector: Pick<AppDetector, "getContext">;
  private readonly createSessionId: () => string;
  private readonly timers = new SessionTimers();
  private pendingEditPromptKey: string | null = null;
  private activeSessionId: string | null = null;
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

    this.clearEditWatch();

    const sessionId = this.createSessionId();
    this.activeSessionId = sessionId;
    this.activeTarget = this.appDetector.getContext();
    this.activeSelection = this.captureSelection(this.activeTarget);
    this.releaseRequestedDuringStart = false;
    this.setState({ status: "starting", sessionId });
    this.armStaleSessionGuard(sessionId);

    if (!this.recorder) {
      this.failSession(sessionId, "Recorder is not ready yet. Please try again in a moment.");
      return;
    }

    this.clearRecorderStartTimer();
    this.timers.setTimeout("recorderStart", () => {
      if (this.isCurrentSession(sessionId) && this.state.status === "starting") {
        this.failSession(sessionId, "Recorder is not ready yet. Please try again in a moment.");
      }
    }, RECORDER_START_TIMEOUT_MS);

    const started = this.recorder.startRecording(sessionId);
    if (!started) {
      this.failSession(sessionId, "Recorder is not ready yet. Please try again in a moment.");
    }
  }

  cancelSession(): void {
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
      this.failSession(sessionId, "Recording could not be finalized.");
      return;
    }
    this.timers.setTimeout("finalization", () => {
      this.failSession(sessionId, "Recording did not finalize. Please try again.");
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
        this.failSession(sessionId, "Microphone opened, but no live audio frames arrived.");
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

    debug("dictation", `submitAudioClip: raw=${payload.clip.durationSeconds.toFixed(2)}s, trimmed=${trimmedClip.durationSeconds.toFixed(2)}s, minClip=${settings.minClipDuration}s`);

    // Save recording to disk if enabled
    if (settings.saveRecordings) {
      void this.saveRecordingToDisk(clippedCopy(payload.clip));
    }

    if (!isValidClip(trimmedClip, settings.minClipDuration)) {
      debug("dictation", "submitAudioClip: clip rejected (too short or empty)");
      this.failSession(payload.sessionId, "No speech detected. Try speaking louder or closer to the microphone.");
      return;
    }

    this.setState({ status: "transcribing", sessionId: payload.sessionId });

    try {
      let transcriptionTimer: ReturnType<typeof setTimeout> | null = null;
      const transcription = await Promise.race([
        this.transcription.transcribe(trimmedClip).finally(() => { if (transcriptionTimer) { clearTimeout(transcriptionTimer); transcriptionTimer = null; } }),
        new Promise<never>((_, reject) => { transcriptionTimer = setTimeout(() => reject(new Error("Transcription timed out. Please try again.")), TRANSCRIPTION_TIMEOUT_MS); }),
      ]);
      if (!this.isCurrentSession(payload.sessionId)) return;

      // Format via LLM using provider system
      let formattedText = transcription.rawText;
      try {
        let formattingTimer: ReturnType<typeof setTimeout> | null = null;
        formattedText = await Promise.race([
          this.transcription.formatTranscript(transcription.rawText).finally(() => { if (formattingTimer) { clearTimeout(formattingTimer); formattingTimer = null; } }),
          new Promise<never>((_, reject) => { formattingTimer = setTimeout(() => reject(new Error("Formatting timed out.")), FORMATTING_TIMEOUT_MS); }),
        ]);
      } catch {
        formattedText = transcription.rawText;
      }

      const textForCleanup = formattedText !== transcription.rawText ? formattedText : transcription.rawText;
      const cleanedText = cleanupText({ rawText: textForCleanup, settings });
      const freshTarget = this.appDetector.getContext();
      const target = isExternalTarget(this.activeTarget) ? this.activeTarget : freshTarget;
      this.activeTarget = target;
      this.activeSelection = this.captureSelection(target);
      const entryBase: Omit<DictationEntry, "injectionStatus" | "injectionMethod"> = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        rawText: transcription.rawText,
        formattedText,
        cleanedText,
        durationSeconds: trimmedClip.durationSeconds,
        appBundleId: target.appBundleId,
        appName: target.appName,
        language: transcription.language
      };

      const injectionTarget = {
        appBundleId: target.appBundleId,
        appName: target.appName,
        selection: this.activeSelection
      };

      let injection = await this.injector.inject(cleanedText, injectionTarget);
      if (!injection.success) {
        const fallbackTarget = this.appDetector.getContext();
        if (isExternalTarget(fallbackTarget) && !sameTarget(injectionTarget, fallbackTarget)) {
          injection = await this.injector.inject(cleanedText, {
            appBundleId: fallbackTarget.appBundleId,
            appName: fallbackTarget.appName,
            selection: this.captureSelection(fallbackTarget)
          });
          if (injection.success) this.activeTarget = fallbackTarget;
        }
      }
      if (!this.isCurrentSession(payload.sessionId)) return;

      if (injection.success) {
        await this.history.append({ ...entryBase, injectionStatus: "injected", injectionMethod: injection.method });
        this.completeSession(payload.sessionId, "injected", cleanedText, "Inserted at cursor");
        this.watchForManualEdits(cleanedText, target);
      } else {
        await this.history.append({ ...entryBase, injectionStatus: "saved", injectionMethod: null });
        this.completeSession(payload.sessionId, "saved", cleanedText, "Saved to history");
      }
    } catch (error) {
      if (!this.isCurrentSession(payload.sessionId)) return;
      const message = error instanceof Error ? error.message : "Dictation failed.";
      this.failSession(payload.sessionId, message);
    }
  }

  reportRecorderReady(): void {}

  handleRecorderFailure(payload: RecorderFailure): void {
    if (!this.isCurrentSession(payload.sessionId)) return;
    this.failSession(payload.sessionId, payload.message);
  }

  reportHotkeyUnavailable(message: string): void {
    this.clearTimers();
    this.activeSessionId = null;
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
    }
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

  private async saveRecordingToDisk(clip: { pcmData: number[]; sampleRate: number; durationSeconds: number; rmsFrames: number[] }): Promise<void> {
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
    } catch {
      // Best-effort saving
    }
  }

  private currentInjectionTarget(entry: Pick<DictationEntry, "appBundleId" | "appName">) {
    const current = this.appDetector.getContext();
    if (isExternalTarget(current)) {
      return { appBundleId: current.appBundleId, appName: current.appName, selection: this.captureSelection(current) };
    }
    return { appBundleId: entry.appBundleId, appName: entry.appName, selection: null };
  }

  private applyDictionarySuggestion(suggestion: DictionarySuggestion): void {
    const spoken = suggestion.spoken.trim();
    const written = suggestion.written.trim();
    if (!spoken || !written) return;
    const current = this.settings.get().customCorrections ?? [];
    const existingIndex = current.findIndex((entry) => entry.spoken.toLowerCase() === spoken.toLowerCase());
    const nextCorrections = existingIndex >= 0
      ? current.map((entry, index) => index === existingIndex ? { spoken, written } : entry)
      : [...current, { spoken, written }];
    this.settings.update({ customCorrections: nextCorrections });
  }

  private watchForManualEdits(insertedText: string, target: Pick<AppContextResult, "appBundleId" | "appName"> | null): void {
    this.clearEditWatch();
    if (!isExternalTarget(target) || !nativeBridge.getFocusedValue) return;

    const initialValue = safeFocusedValue();
    this.timers.setInterval("editWatch", () => {
      if (!sameTarget(target, this.appDetector.getContext())) return;

      const currentValue = safeFocusedValue();
      if (!currentValue || currentValue === initialValue || currentValue === insertedText) return;

      const correctedCandidate = extractCorrectedInsertedText(initialValue, currentValue, insertedText);
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
    this.timers.setTimeout("editPrompt", () => {
      this.clearEditWatch();
      const suggestions = detectDictionarySuggestions(insertedText, correctedCandidate);
      if (suggestions.length > 0 && !isSnippetLikeContent(correctedCandidate)) {
        void this.showDictionarySuggestions(suggestions);
        return;
      }

      if (shouldSuggestSnippet(insertedText, correctedCandidate)) {
        void this.showSnippetSuggestion(correctedCandidate);
      }
    }, EDIT_PROMPT_IDLE_MS);
  }

  private completeSession(sessionId: string, outcome: DictationCompletionOutcome, text: string, message: string): void {
    if (!this.isCurrentSession(sessionId)) return;
    this.clearAudioFrameTimer();
    this.setState({ status: "completed", sessionId, outcome, text, message });
    this.scheduleReset(SUCCESS_RESET_MS);
  }

  private failSession(sessionId: string, message: string): void {
    if (!this.isCurrentSession(sessionId)) return;
    this.clearRecorderStartTimer();
    this.clearAudioFrameTimer();
    this.clearFinalizationTimer();
    this.setState({ status: "error", sessionId, message });
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
      this.updateTrayStatus(state.outcome === "saved" ? "Saved" : "Done"); this.overlay.setSuccess();
    } else if (state.status === "error") {
      this.updateTrayStatus("Error"); this.overlay.setError();
    } else {
      this.updateTrayStatus("Error"); this.overlay.hide();
    }
    if (state.status === "idle") { this.activeSessionId = null; this.activeTarget = null; }
    this.mainWindow?.webContents.send(IpcChannel.DictationState, state);
  }
}

function clippedCopy(clip: { pcmData: number[]; sampleRate: number; durationSeconds: number; rmsFrames: number[] }): { pcmData: number[]; sampleRate: number; durationSeconds: number; rmsFrames: number[] } {
  return { pcmData: [...clip.pcmData], sampleRate: clip.sampleRate, durationSeconds: clip.durationSeconds, rmsFrames: [...clip.rmsFrames] };
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
