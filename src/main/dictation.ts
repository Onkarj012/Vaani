import { BrowserWindow } from "electron";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
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
import { OverlayController } from "./overlay";
import { HistoryStore } from "./store/history";
import { SettingsStore } from "./store/settings";
import { CredentialsStore } from "./store/credentials";
import { cleanupText } from "./text/cleanup";
import { detectDictionarySuggestions } from "@shared/dictionarySuggestions";
import { TranscriptionService } from "./transcription";

const FINALIZATION_TIMEOUT_MS = 4_000;
const TRANSCRIPTION_TIMEOUT_MS = 30_000;
const AUDIO_FRAME_TIMEOUT_MS = 1_600;
const RECORDER_START_TIMEOUT_MS = 5_000;

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
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private finalizationTimer: ReturnType<typeof setTimeout> | null = null;
  private audioFrameTimer: ReturnType<typeof setTimeout> | null = null;
  private recorderStartTimer: ReturnType<typeof setTimeout> | null = null;
  private activeSessionId: string | null = null;
  private activeTarget: AppContextResult | null = null;
  private activeSelection: SelectionRange | null = null;
  private releaseRequestedDuringStart = false;
  private readonly recorder: RecorderCommands | null;
  private pasteLatestInProgress = false;
  private lastInjectedText: string | null = null;

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

    // Before starting a new dictation, check if the user manually edited
    // the last injected text in the target app (e.g. fixed a typo in their
    // browser). If so, detect word diffs and prompt to add to dictionary.
    if (this.lastInjectedText && this.activeTarget) {
      try {
        const currentValue = nativeBridge.getFocusedValue?.();
        if (currentValue && currentValue !== this.lastInjectedText) {
          const suggestions = detectDictionarySuggestions(this.lastInjectedText, currentValue);
          if (suggestions.length > 0) {
            void this.showDictionarySuggestions(suggestions);
          }
        }
      } catch { /* best-effort */ }
    }
    this.lastInjectedText = null;

    const sessionId = this.createSessionId();
    this.activeSessionId = sessionId;
    this.activeTarget = this.appDetector.getContext();
    this.activeSelection = this.captureSelection(this.activeTarget);
    this.releaseRequestedDuringStart = false;
    this.setState({ status: "starting", sessionId });

    if (!this.recorder) {
      this.failSession(sessionId, "Recorder is not ready yet. Please try again in a moment.");
      return;
    }

    this.clearRecorderStartTimer();
    this.recorderStartTimer = setTimeout(() => {
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
    this.finalizationTimer = setTimeout(() => {
      this.failSession(sessionId, "Recording did not finalize. Please try again.");
    }, FINALIZATION_TIMEOUT_MS);
  }

  reportRecorderStarted(sessionId: string): void {
    if (!this.isCurrentSession(sessionId) || this.state.status !== "starting") {
      return;
    }

    this.clearRecorderStartTimer();
    this.setState({ status: "recording", sessionId });
    this.clearAudioFrameTimer();
    this.audioFrameTimer = setTimeout(() => {
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

    console.log(`[vaani] submitAudioClip: raw=${payload.clip.durationSeconds.toFixed(2)}s, trimmed=${trimmedClip.durationSeconds.toFixed(2)}s, minClip=${settings.minClipDuration}s`);

    // Save recording to disk if enabled
    if (settings.saveRecordings) {
      this.saveRecordingToDisk(clippedCopy(payload.clip));
    }

    if (!isValidClip(trimmedClip, settings.minClipDuration)) {
      console.log(`[vaani] submitAudioClip: clip rejected (too short or empty)`);
      this.failSession(payload.sessionId, "No speech detected. Try speaking louder or closer to the microphone.");
      return;
    }

    this.setState({ status: "transcribing", sessionId: payload.sessionId });

    try {
      const transcription = await Promise.race([
        this.transcription.transcribe(trimmedClip),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Transcription timed out. Please try again.")), TRANSCRIPTION_TIMEOUT_MS)
        ),
      ]);
      if (!this.isCurrentSession(payload.sessionId)) return;

      // Format via LLM using provider system
      let formattedText = transcription.rawText;
      try {
        formattedText = await this.transcription.formatTranscript(transcription.rawText);
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

        // Remember injected text so the next dictation can detect if the user
        // manually corrected typos in the target app before dictating again.
        this.lastInjectedText = cleanedText;
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

  navigateToHistoryEntry(entryId: string): void {
    const route = `/4/history?editEntryId=${encodeURIComponent(entryId)}`;
    this.mainWindow?.show();
    this.mainWindow?.focus();
    this.mainWindow?.webContents.send(IpcChannel.Navigation, { route });
  }

  private saveRecordingToDisk(clip: { pcmData: number[]; sampleRate: number; durationSeconds: number; rmsFrames: number[] }): void {
    try {
      const settings = this.settings.get();
      const dir = settings.recordingsPath || join(homedir(), "Documents", "Vaani Recordings");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

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
      writeFileSync(filepath, buf);
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
    this.resetTimer = setTimeout(() => this.resetToIdle(), timeoutMs);
  }

  private clearTimers(): void {
    this.clearResetTimer();
    this.clearRecorderStartTimer();
    this.clearFinalizationTimer();
    this.clearAudioFrameTimer();
  }

  private clearResetTimer(): void { if (this.resetTimer) { clearTimeout(this.resetTimer); this.resetTimer = null; } }
  private clearFinalizationTimer(): void { if (this.finalizationTimer) { clearTimeout(this.finalizationTimer); this.finalizationTimer = null; } }
  private clearAudioFrameTimer(): void { if (this.audioFrameTimer) { clearTimeout(this.audioFrameTimer); this.audioFrameTimer = null; } }
  private clearRecorderStartTimer(): void { if (this.recorderStartTimer) { clearTimeout(this.recorderStartTimer); this.recorderStartTimer = null; } }

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
