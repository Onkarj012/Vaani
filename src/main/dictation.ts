import { BrowserWindow } from "electron";
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
import { cleanupText } from "./text/cleanup";
import { TranscriptionService } from "./transcription";

const FINALIZATION_TIMEOUT_MS = 4_000;
const TRANSCRIPTION_TIMEOUT_MS = 30_000;

interface DictationServiceDeps {
  transcription?: Pick<TranscriptionService, "transcribe">;
  injector?: Pick<TextInjector, "inject">;
  appDetector?: Pick<AppDetector, "getContext">;
  createSessionId?: () => string;
}

export class DictationService {
  private state: DictationState = { status: "idle" };
  private readonly transcription: Pick<TranscriptionService, "transcribe">;
  private readonly injector: Pick<TextInjector, "inject">;
  private readonly appDetector: Pick<AppDetector, "getContext">;
  private readonly createSessionId: () => string;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private finalizationTimer: ReturnType<typeof setTimeout> | null = null;
  private activeSessionId: string | null = null;
  private activeTarget: AppContextResult | null = null;
  private activeSelection: SelectionRange | null = null;

  constructor(
    private readonly mainWindow: BrowserWindow | null,
    private readonly settings: SettingsStore,
    private readonly history: HistoryStore,
    private readonly updateTrayStatus: (label: string) => void,
    private readonly overlay: OverlayController,
    deps: DictationServiceDeps = {}
  ) {
    this.transcription = deps.transcription ?? new TranscriptionService(() => this.settings.get());
    this.injector = deps.injector ?? new TextInjector(() => this.settings.get());
    this.appDetector = deps.appDetector ?? new AppDetector();
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
    const sessionId = this.createSessionId();
    this.activeSessionId = sessionId;
    this.activeTarget = this.appDetector.getContext();
    this.activeSelection = this.captureSelection(this.activeTarget);
    this.setState({ status: "recording", sessionId });
  }

  cancelSession(): void {
    this.resetToIdle();
  }

  endHotkeySession(): void {
    if (this.state.status !== "recording") {
      return;
    }

    const { sessionId } = this.state;
    this.setState({ status: "finalizing", sessionId });
    this.clearFinalizationTimer();
    this.finalizationTimer = setTimeout(() => {
      this.failSession(sessionId, "Recording did not finalize. Please try again.");
    }, FINALIZATION_TIMEOUT_MS);
  }

  async submitAudioClip(payload: RecorderSubmission): Promise<void> {
    if (this.state.status !== "finalizing" || payload.sessionId !== this.state.sessionId) {
      return;
    }

    this.clearFinalizationTimer();
    const settings = this.settings.get();
    const trimmedClip = trimSilence(payload.clip, settings.silenceThreshold);
    if (!isValidClip(trimmedClip, settings.minClipDuration)) {
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
      if (!this.isCurrentSession(payload.sessionId)) {
        return;
      }

      // Use formattedText when the LLM added structural formatting (newlines, list markers).
      // cleanupText already handles multiline content correctly via its normalizeLineWhitespace path.
      const textForCleanup = transcription.formattedText !== transcription.rawText
        ? transcription.formattedText
        : transcription.rawText;
      const cleanedText = cleanupText({ rawText: textForCleanup, settings });
      const freshTarget = this.appDetector.getContext();
      const target = isExternalTarget(freshTarget) ? freshTarget : (this.activeTarget ?? freshTarget);
      this.activeTarget = target;
      this.activeSelection = this.captureSelection(target);
      const entry: DictationEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        rawText: transcription.rawText,
        formattedText: transcription.formattedText,
        cleanedText,
        durationSeconds: trimmedClip.durationSeconds,
        appBundleId: target.appBundleId,
        appName: target.appName,
        injectionStatus: "saved",
        injectionMethod: null,
        language: transcription.language
      };

      await this.history.append(entry);
      if (!this.isCurrentSession(payload.sessionId)) {
        return;
      }

      const injection = await this.injector.inject(cleanedText, {
        appBundleId: target.appBundleId,
        appName: target.appName,
        selection: this.activeSelection
      });
      if (!this.isCurrentSession(payload.sessionId)) {
        return;
      }

      if (injection.success) {
        await this.history.updateById(entry.id, (current) => ({
          ...current,
          injectionStatus: "injected",
          injectionMethod: injection.method
        }));
        this.completeSession(payload.sessionId, "injected", cleanedText, "Inserted at cursor");
        return;
      }

      this.completeSession(payload.sessionId, "saved", cleanedText, "Saved to history");
    } catch (error) {
      if (!this.isCurrentSession(payload.sessionId)) {
        return;
      }

      const message = error instanceof Error ? error.message : "Dictation failed.";
      this.failSession(payload.sessionId, message);
    }
  }

  reportRecorderReady(): void {
    // Reserved for future recorder warm-up integration.
  }

  handleRecorderFailure(payload: RecorderFailure): void {
    if (!this.isCurrentSession(payload.sessionId)) {
      return;
    }

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
    if (this.state.status !== "recording" && this.state.status !== "finalizing") {
      return;
    }

    this.overlay.updateBars(frame.bars);
    // Send both level and bars to renderer for visualization
    this.mainWindow?.webContents.send(IpcChannel.AudioLevel, frame.level, frame.bars);
  }

  async reinjectEntry(id: string): Promise<void> {
    const entry = await this.history.getById(id);
    if (!entry) {
      return;
    }

    const result = await this.injector.inject(entry.cleanedText, this.currentInjectionTarget(entry));
    if (!result.success) {
      this.setState({
        status: "error",
        sessionId: null,
        message: messageForInjectionFailure(result.reason)
      });
      this.scheduleReset(ERROR_RESET_MS);
      return;
    }

    const sessionId = this.createSessionId();
    this.setState({
      status: "completed",
      sessionId,
      outcome: "injected",
      text: entry.cleanedText,
      message: "Inserted at cursor"
    });
    this.scheduleReset(SUCCESS_RESET_MS);
  }

  async pasteLatestEntry(): Promise<void> {
    const latest = await this.history.getLatest();
    if (!latest) {
      this.setState({ status: "error", sessionId: null, message: "No previous dictation is available yet." });
      this.scheduleReset(ERROR_RESET_MS);
      return;
    }

    const result = await this.injector.inject(latest.cleanedText, this.currentInjectionTarget(latest));
    if (!result.success) {
      this.setState({
        status: "error",
        sessionId: null,
        message: messageForInjectionFailure(result.reason)
      });
      this.scheduleReset(ERROR_RESET_MS);
      return;
    }

    const sessionId = this.createSessionId();
    this.setState({
      status: "completed",
      sessionId,
      outcome: "injected",
      text: latest.cleanedText,
      message: "Inserted at cursor"
    });
    this.scheduleReset(SUCCESS_RESET_MS);
  }

  getState(): DictationState {
    return this.state;
  }

  async getById(id: string): Promise<DictationEntry | undefined> {
    return this.history.getById(id);
  }

  async showDictionarySuggestions(suggestions: DictionarySuggestion[]): Promise<void> {
    for (const suggestion of suggestions) {
      const accepted = await new Promise<boolean>((resolve) => {
        this.overlay.showDictionaryPrompt(suggestion.spoken, suggestion.written, resolve);
      });

      if (accepted) {
        this.applyDictionarySuggestion(suggestion);
      }
    }
  }

  private currentInjectionTarget(entry: Pick<DictationEntry, "appBundleId" | "appName">) {
    const current = this.appDetector.getContext();
    if (isExternalTarget(current)) {
      return {
        appBundleId: current.appBundleId,
        appName: current.appName,
        selection: this.captureSelection(current)
      };
    }

    return {
      appBundleId: entry.appBundleId,
      appName: entry.appName,
      selection: null
    };
  }

  navigateToHistoryEntry(entryId: string): void {
    const route = `/4/history?editEntryId=${encodeURIComponent(entryId)}`;
    this.mainWindow?.show();
    this.mainWindow?.focus();
    this.mainWindow?.webContents.send(IpcChannel.Navigation, { route });
  }

  private applyDictionarySuggestion(suggestion: DictionarySuggestion): void {
    const spoken = suggestion.spoken.trim();
    const written = suggestion.written.trim();
    if (!spoken || !written) {
      return;
    }

    const current = this.settings.get().customCorrections ?? [];
    const existingIndex = current.findIndex((entry) => entry.spoken.toLowerCase() === spoken.toLowerCase());
    const nextCorrections = existingIndex >= 0
      ? current.map((entry, index) => index === existingIndex ? { spoken, written } : entry)
      : [...current, { spoken, written }];
    this.settings.update({ customCorrections: nextCorrections });
  }

  private completeSession(
    sessionId: string,
    outcome: DictationCompletionOutcome,
    text: string,
    message: string
  ): void {
    if (!this.isCurrentSession(sessionId)) {
      return;
    }

    this.setState({
      status: "completed",
      sessionId,
      outcome,
      text,
      message
    });
    this.scheduleReset(SUCCESS_RESET_MS);
  }

  private failSession(sessionId: string, message: string): void {
    if (!this.isCurrentSession(sessionId)) {
      return;
    }

    this.setState({ status: "error", sessionId, message });
    this.scheduleReset(ERROR_RESET_MS);
  }

  private resetToIdle(): void {
    this.clearTimers();
    this.activeSessionId = null;
    this.activeTarget = null;
    this.activeSelection = null;
    this.setState({ status: "idle" });
  }

  private scheduleReset(timeoutMs: number): void {
    this.clearResetTimer();
    this.resetTimer = setTimeout(() => {
      this.resetToIdle();
    }, timeoutMs);
  }

  private clearTimers(): void {
    this.clearResetTimer();
    this.clearFinalizationTimer();
  }

  private clearResetTimer(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }

  private clearFinalizationTimer(): void {
    if (this.finalizationTimer) {
      clearTimeout(this.finalizationTimer);
      this.finalizationTimer = null;
    }
  }

  private isCurrentSession(sessionId: string): boolean {
    return this.activeSessionId === sessionId;
  }

  // Dictionary suggestions are handled in the renderer's History UI when
  // the user manually edits text. The overlay.showDictionaryPrompt() and
  // detectDictionarySuggestions() APIs are available if needed in the future.

  private captureSelection(target?: Pick<AppContextResult, "appBundleId" | "appName"> | null): SelectionRange | null {
    if (!isExternalTarget(target ?? undefined)) {
      return null;
    }

    try {
      const selection = nativeBridge.getFocusedSelection?.();
      if (!selection) {
        return null;
      }

      const location = Number.isFinite(selection.location) ? Math.max(0, Math.trunc(selection.location)) : NaN;
      const length = Number.isFinite(selection.length) ? Math.max(0, Math.trunc(selection.length)) : NaN;
      if (!Number.isFinite(location) || !Number.isFinite(length)) {
        return null;
      }

      return { location, length };
    } catch {
      return null;
    }
  }

  private setState(state: DictationState): void {
    this.state = state;

    if (state.status === "idle") {
      this.updateTrayStatus("Ready");
      this.overlay.hide();
    } else if (state.status === "recording") {
      this.updateTrayStatus("Recording…");
      this.overlay.setRecording();
    } else if (state.status === "finalizing") {
      this.updateTrayStatus("Processing…");
      this.overlay.setProcessing();
    } else if (state.status === "transcribing") {
      this.updateTrayStatus("Transcribing…");
      this.overlay.setProcessing();
    } else if (state.status === "completed") {
      this.updateTrayStatus(state.outcome === "saved" ? "Saved" : "Done");
      this.overlay.setSuccess();
    } else if (state.status === "error") {
      this.updateTrayStatus("Error");
      this.overlay.setError();
    } else {
      this.updateTrayStatus("Error");
      this.overlay.hide();
    }

    if (state.status === "idle") {
      this.activeSessionId = null;
      this.activeTarget = null;
    }

    this.mainWindow?.webContents.send(IpcChannel.DictationState, state);
  }
}

function isExternalTarget(
  context: Pick<AppContextResult, "appBundleId" | "appName"> | null | undefined
): boolean {
  if (!context) {
    return false;
  }

  const bundleId = context.appBundleId?.trim().toLowerCase() ?? "";
  const appName = context.appName?.trim().toLowerCase() ?? "";
  const internalBundleIds = new Set(["com.claudevaani.app", "com.github.electron"]);
  const internalAppNames = new Set(["claude vaani", "electron"]);
  return !internalBundleIds.has(bundleId) && !internalAppNames.has(appName);
}

function messageForInjectionFailure(reason: InjectionFailureReason): string {
  switch (reason) {
    case "permission_missing":
      return "Accessibility permission is missing for text insertion.";
    case "no_editable_target":
      return "No editable text field is focused.";
    default:
      return "Could not paste the latest dictation.";
  }
}
