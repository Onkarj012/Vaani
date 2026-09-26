import type { AudioClip, AudioInputDevice, AudioVisualFrame, RecorderConfig, RecorderFailure, RecorderSubmission } from "@shared/types";
import { PcmRingBuffer, PRE_ROLL_MS, TARGET_SAMPLE_RATE, mergePcmChunks, pcmToAudioClip, trimLeadingSilence } from "@shared/pcmUtils";
import { debug, error } from "@main/log";
import { nativeBridge } from "@main/nativeBridge";
import { STOP_MAX_WAIT_MS, STOP_POLL_MS, STOP_QUIET_MS, STOP_TAIL_GRACE_MS, trailingRms } from "@shared/recorderTail";

// After the grace window, wait for the native drain queue to go quiet so audio
// still in the C++ ring / TSFN queue is not discarded with the session.
const FRAME_REPORT_INTERVAL_MS = 50;
const VISUAL_BAR_COUNT = 9;
const BAR_BASELINE = 0.04;
// Visualizer deadband: bars stay flat until the signal clears the rolling
// noise floor, so a silent room does not animate the capsule.
const BAR_NOISE_FLOOR_MIN = 0.003;
const BAR_NOISE_FLOOR_MARGIN = 1.8;

export interface NativeCaptureSink {
  reportRecorderStarted(sessionId: string): void;
  submitAudioClip(payload: RecorderSubmission): void | Promise<void>;
  updateAudioLevel(frame: AudioVisualFrame): void;
  handleRecorderFailure(payload: RecorderFailure, partialClip?: ReturnType<typeof pcmToAudioClip>): void;
}

export interface RecorderCommands {
  isReady: () => boolean;
  startRecording: (sessionId: string) => boolean;
  stopRecording: (sessionId: string) => boolean;
  abortRecording?: (sessionId: string) => void;
  suspendForLifecycle?: () => CaptureSuspendResult | Promise<CaptureSuspendResult>;
  resumeAfterLifecycle?: () => CaptureResumeResult;
}

export interface CaptureSuspendResult {
  wasRunning: boolean;
  sessionId: string | null;
  partialClip?: AudioClip;
  recordingResumed?: boolean;
}

export interface CaptureResumeResult {
  ok: boolean;
  selectedDeviceUid: string | null;
  message?: string;
}

type NativeCaptureBridge = {
  audioCaptureStart?: (options: { deviceUid?: string; onData: (payload: Float32Array) => void; onError: (message: string) => void }) => boolean;
  audioCaptureStop?: () => void;
  audioCaptureListInputDevices?: () => AudioInputDevice[];
  audioCaptureIsRunning?: () => boolean;
};

export function listNativeInputDevices(bridge: NativeCaptureBridge = nativeBridge): AudioInputDevice[] {
  try {
    return bridge.audioCaptureListInputDevices?.() ?? [];
  } catch (err) {
    error("native-capture", `list input devices failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export function selectNativeInputDevice(devices: AudioInputDevice[], preferredUid?: string): { ok: true; uid: string } | { ok: false; message: string } {
  const physical = devices.filter((device) => device.isPhysical);
  if (preferredUid && physical.some((device) => device.uid === preferredUid)) {
    return { ok: true, uid: preferredUid };
  }
  const builtIn = physical.find((device) => device.transportType === "built-in");
  return builtIn
    ? { ok: true, uid: builtIn.uid }
    : { ok: false, message: "No built-in microphone found. Choose a microphone in Settings." };
}

export function shouldUseNativeBackend(config: Pick<RecorderConfig, "captureBackend">, nativeUnavailable: boolean, bridge: NativeCaptureBridge = nativeBridge): boolean {
  return config.captureBackend !== "renderer" && !nativeUnavailable && typeof bridge.audioCaptureStart === "function";
}

export class NativeCaptureService implements RecorderCommands {
  private ring = new PcmRingBuffer(TARGET_SAMPLE_RATE * PRE_ROLL_MS / 1000);
  private activeSessionId: string | null = null;
  private chunks: Float32Array[] = [];
  private lastChunkAt = 0;
  private lastFrameAt = 0;
  private noiseFloor = 0;
  private lastReportedAt = 0;
  private smoothedBars = new Array(VISUAL_BAR_COUNT).fill(BAR_BASELINE);
  private currentDeviceUid: string | null = null;
  private currentConfig: RecorderConfig = { preWarmMic: false, captureBackend: "renderer" };
  private startPromise: Promise<boolean> | null = null;
  private transportGeneration = 0;
  private suspended = false;

  constructor(
    private readonly getConfig: () => RecorderConfig,
    private readonly sink: NativeCaptureSink,
    private readonly bridge: NativeCaptureBridge = nativeBridge
  ) {}

  isReady(): boolean {
    return typeof this.bridge.audioCaptureStart === "function";
  }

  warm(): boolean {
    this.currentConfig = this.normalizeConfig(this.getConfig());
    if (!this.currentConfig.preWarmMic) return true;
    return this.ensureCapture(this.currentConfig);
  }

  updateConfig(config: RecorderConfig): void {
    const nextConfig = this.normalizeConfig(config);
    const keyChanged = this.configKey(nextConfig) !== this.configKey(this.currentConfig);
    this.currentConfig = nextConfig;
    if (!keyChanged || this.activeSessionId) return;
    this.shutdown();
    if (nextConfig.preWarmMic && nextConfig.captureBackend !== "renderer") {
      this.ensureCapture(nextConfig);
    }
  }

  startRecording(sessionId: string): boolean {
    this.currentConfig = this.normalizeConfig(this.getConfig());
    this.chunks = [];
    this.lastFrameAt = 0;
    this.resetBars();

    if (!this.ensureCapture(this.currentConfig)) {
      return false;
    }

    const preRoll = trimLeadingSilence(this.ring.snapshot(Math.floor(TARGET_SAMPLE_RATE * PRE_ROLL_MS / 1000)), TARGET_SAMPLE_RATE);
    if (preRoll.length > 0) this.chunks.push(preRoll);
    this.activeSessionId = sessionId;
    this.sink.reportRecorderStarted(sessionId);
    return true;
  }

  stopRecording(sessionId: string): boolean {
    if (this.activeSessionId !== sessionId) return true;
    const stopRequestedAt = Date.now();

    const finalize = (): void => {
      if (this.activeSessionId !== sessionId) return;
      const chunksAtStop = this.chunks.slice();
      this.activeSessionId = null;
      this.chunks = [];
      const merged = mergePcmChunks(chunksAtStop);
      if (merged.length === 0) {
        this.restartCaptureIfPrewarmed();
        this.sink.handleRecorderFailure({ sessionId, message: "Recording could not be finalized." });
        return;
      }
      void this.sink.submitAudioClip({ sessionId, clip: pcmToAudioClip(merged, TARGET_SAMPLE_RATE), tailMetrics: {
        lastFrameAfterStopMs: this.lastFrameAt ? this.lastFrameAt - stopRequestedAt : 0,
        trailingRms: trailingRms(merged, TARGET_SAMPLE_RATE),
      } });
      this.restartCaptureIfPrewarmed();
    };

    const poll = (): void => {
      if (this.activeSessionId !== sessionId) return;
      const elapsed = Date.now() - stopRequestedAt;
      const quietFor = Date.now() - this.lastChunkAt;
      if (elapsed >= STOP_MAX_WAIT_MS || quietFor >= STOP_QUIET_MS) {
        finalize();
        return;
      }
      setTimeout(poll, STOP_POLL_MS);
    };

    setTimeout(() => {
      if (this.activeSessionId !== sessionId) return;
      this.lastChunkAt = Date.now();
      this.stopCaptureTransport();
      poll();
    }, STOP_TAIL_GRACE_MS);
    return true;
  }

  suspendForLifecycle(): CaptureSuspendResult | Promise<CaptureSuspendResult> {
    const sessionId = this.activeSessionId;
    const wasRunning = this.bridge.audioCaptureIsRunning?.() ?? this.currentDeviceUid !== null;
    const partialSamples = sessionId ? mergePcmChunks(this.chunks) : new Float32Array();
    this.suspended = true;
    this.stopCaptureTransport();
    this.ring.clear();
    this.resetBars();
    return {
      wasRunning,
      sessionId,
      ...(partialSamples.length > 0 ? { partialClip: pcmToAudioClip(partialSamples, TARGET_SAMPLE_RATE) } : {}),
    };
  }

  abortRecording(sessionId: string): void {
    if (this.activeSessionId !== sessionId) return;
    this.stopCaptureTransport();
    this.activeSessionId = null;
    this.chunks = [];
  }

  resumeAfterLifecycle(): CaptureResumeResult {
    if (!this.suspended) return { ok: true, selectedDeviceUid: this.currentDeviceUid };
    try {
      const devices = listNativeInputDevices(this.bridge);
      const selected = selectNativeInputDevice(devices, this.currentConfig.micDeviceId);
      if (!selected.ok) return { ok: false, selectedDeviceUid: null, message: selected.message };
      if (!this.currentConfig.preWarmMic && !this.activeSessionId) {
        this.suspended = false;
        return { ok: true, selectedDeviceUid: selected.uid };
      }
      const ok = this.ensureCapture(this.currentConfig);
      if (!ok) return { ok: false, selectedDeviceUid: null, message: "Native capture could not be resumed." };
      this.suspended = false;
      return { ok: true, selectedDeviceUid: this.currentDeviceUid };
    } catch (err) {
      return { ok: false, selectedDeviceUid: null, message: err instanceof Error ? err.message : String(err) };
    }
  }

  shutdown(): void {
    this.stopCaptureTransport();
    this.currentDeviceUid = null;
    this.activeSessionId = null;
    this.chunks = [];
    this.ring.clear();
  }

  private ensureCapture(config: RecorderConfig): boolean {
    if (this.startPromise) {
      debug("native-capture", "capture start already in progress");
      return true;
    }
    const devices = listNativeInputDevices(this.bridge);
    const selected = selectNativeInputDevice(devices, config.micDeviceId);
    if (!selected.ok) {
      throw new Error(selected.message);
    }
    const isRunning = this.bridge.audioCaptureIsRunning?.() ?? false;
    if (isRunning && this.currentDeviceUid === selected.uid) {
      return true;
    }
    this.stopCaptureTransport();
    this.ring.clear();
    this.resetBars();
    const generation = ++this.transportGeneration;
    const ok = this.bridge.audioCaptureStart?.({
      deviceUid: selected.uid,
      onData: (samples) => this.handleData(samples, generation),
      onError: (message) => this.handleNativeError(message, generation),
    }) ?? false;
    if (!ok) {
      this.currentDeviceUid = null;
      return false;
    }
    this.currentDeviceUid = selected.uid;
    return true;
  }

  private handleData(samples: Float32Array, generation: number): void {
    if (generation !== this.transportGeneration) return;
    this.ring.append(samples);
    this.lastChunkAt = Date.now();
    this.lastFrameAt = this.lastChunkAt;
    this.updateNoiseFloor(samples);
    if (!this.activeSessionId) return;
    this.chunks.push(samples.slice());
    this.publishBars(buildBarsFromSamples(samples, VISUAL_BAR_COUNT, this.noiseFloor));
  }

  private updateNoiseFloor(samples: Float32Array): void {
    const rms = chunkRms(samples);
    if (rms <= 0) return;
    if (rms < this.noiseFloor || this.noiseFloor === 0) {
      this.noiseFloor = rms;
    } else {
      this.noiseFloor += (rms - this.noiseFloor) * 0.02;
    }
  }

  private handleNativeError(message: string, generation: number): void {
    if (generation !== this.transportGeneration) return;
    const sessionId = this.activeSessionId;
    const partialSamples = this.activeSessionId ? mergePcmChunks(this.chunks) : new Float32Array();
    const partialClip = partialSamples.length > 0 ? pcmToAudioClip(partialSamples, TARGET_SAMPLE_RATE) : undefined;
    this.suspended = false;
    this.stopCaptureTransport();
    this.ring.clear();
    this.activeSessionId = null;
    this.chunks = [];
    if (sessionId) {
      this.sink.handleRecorderFailure({ sessionId, message, kind: "interrupted" }, partialClip);
    }
  }

  private stopCaptureTransport(): void {
    this.transportGeneration += 1;
    try {
      this.bridge.audioCaptureStop?.();
    } catch (err) {
      error("native-capture", `stop failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.currentDeviceUid = null;
  }

  private restartCaptureIfPrewarmed(): void {
    if (!this.currentConfig.preWarmMic || this.currentConfig.captureBackend === "renderer") return;
    try {
      this.ensureCapture(this.currentConfig);
    } catch (err) {
      error("native-capture", `prewarm restart failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private publishBars(nextBars: number[]): void {
    const now = Date.now();
    if (now - this.lastReportedAt < FRAME_REPORT_INTERVAL_MS) return;
    this.lastReportedAt = now;
    const bars = nextBars.map((value, index) => {
      const previous = this.smoothedBars[index] ?? 0.12;
      return Math.max(0.04, previous * 0.65 + value * 0.35);
    });
    this.smoothedBars = bars;
    const level = bars.reduce((sum, value) => sum + value, 0) / Math.max(1, bars.length);
    this.sink.updateAudioLevel({ level, bars });
  }

  private normalizeConfig(config: RecorderConfig): RecorderConfig {
    return {
      micDeviceId: config.micDeviceId,
      preWarmMic: config.preWarmMic ?? false,
      captureBackend: config.captureBackend ?? "renderer",
    };
  }

  private configKey(config: RecorderConfig): string {
    return `${config.captureBackend ?? "renderer"}:${config.preWarmMic ? "warm" : "ondemand"}:${config.micDeviceId ?? ""}`;
  }

  private resetBars(): void {
    this.smoothedBars = new Array(VISUAL_BAR_COUNT).fill(BAR_BASELINE);
    this.lastReportedAt = 0;
  }
}

export class CaptureBackendController implements RecorderCommands {
  private nativeUnavailable = false;
  private activeBackend: "native" | "renderer" | null = null;

  constructor(
    private readonly getConfig: () => RecorderConfig,
    private readonly nativeCapture: NativeCaptureService,
    private readonly rendererRecorder: RecorderCommands
  ) {}

  isReady(): boolean {
    const config = this.getConfig();
    if (this.shouldTryNative(config)) return this.nativeCapture.isReady();
    return this.rendererRecorder.isReady();
  }

  startRecording(sessionId: string): boolean {
    const config = this.getConfig();
    if (this.shouldTryNative(config)) {
      try {
        if (this.nativeCapture.startRecording(sessionId)) {
          this.activeBackend = "native";
          return true;
        }
        this.markNativeUnavailable("native capture start returned false");
      } catch (err) {
        this.markNativeUnavailable(err instanceof Error ? err.message : String(err));
      }
    }
    this.activeBackend = "renderer";
    return this.rendererRecorder.startRecording(sessionId);
  }

  stopRecording(sessionId: string): boolean {
    if (this.activeBackend === "native") {
      return this.nativeCapture.stopRecording(sessionId);
    }
    return this.rendererRecorder.stopRecording(sessionId);
  }

  suspendForLifecycle(): CaptureSuspendResult | Promise<CaptureSuspendResult> {
    if (this.activeBackend === "renderer" || this.getConfig().captureBackend === "renderer") {
      return this.rendererRecorder.suspendForLifecycle?.() ?? { wasRunning: false, sessionId: null };
    }
    return this.nativeCapture.suspendForLifecycle();
  }

  resumeAfterLifecycle(): CaptureResumeResult {
    if (this.activeBackend === "renderer" || this.getConfig().captureBackend === "renderer") {
      return this.rendererRecorder.resumeAfterLifecycle?.() ?? { ok: true, selectedDeviceUid: null };
    }
    return this.nativeCapture.resumeAfterLifecycle();
  }

  abortRecording(sessionId: string): void {
    if (this.activeBackend === "renderer") {
      this.rendererRecorder.abortRecording?.(sessionId);
    } else {
      this.nativeCapture.abortRecording(sessionId);
    }
    this.activeBackend = null;
  }

  updateConfig(config: RecorderConfig): void {
    this.nativeCapture.updateConfig(config);
    if ("updateConfig" in this.rendererRecorder && typeof this.rendererRecorder.updateConfig === "function") {
      this.rendererRecorder.updateConfig(config);
    }
  }

  warmNative(): void {
    const config = this.getConfig();
    if (!this.shouldTryNative(config) || !config.preWarmMic) return;
    try {
      if (!this.nativeCapture.warm()) {
        this.markNativeUnavailable("native warm start returned false");
      }
    } catch (err) {
      this.markNativeUnavailable(err instanceof Error ? err.message : String(err));
    }
  }

  destroy(): void {
    this.nativeCapture.shutdown();
    if ("destroy" in this.rendererRecorder && typeof this.rendererRecorder.destroy === "function") {
      this.rendererRecorder.destroy();
    }
  }

  private markNativeUnavailable(reason: string): void {
    if (!this.nativeUnavailable) {
      debug("native-capture", `native unavailable until restart: ${reason}`);
    }
    this.nativeUnavailable = true;
    this.nativeCapture.shutdown();
  }

  private shouldTryNative(config: Pick<RecorderConfig, "captureBackend">): boolean {
    return config.captureBackend !== "renderer" && !this.nativeUnavailable && this.nativeCapture.isReady();
  }
}

function buildBarsFromSamples(samples: Float32Array, count: number, noiseFloor: number): number[] {
  if (samples.length === 0) return new Array(count).fill(BAR_BASELINE);
  const gateLevel = Math.max(BAR_NOISE_FLOOR_MIN, noiseFloor * BAR_NOISE_FLOOR_MARGIN);
  if (chunkRms(samples) < gateLevel) return new Array(count).fill(BAR_BASELINE);

  const bars: number[] = [];
  const segmentSize = Math.max(1, Math.floor(samples.length / count));
  for (let index = 0; index < count; index += 1) {
    const start = index * segmentSize;
    const end = Math.min(samples.length, start + segmentSize);
    let sum = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const sample = samples[sampleIndex] ?? 0;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    bars.push(Math.min(1, Math.max(BAR_BASELINE, (rms - noiseFloor) * 8)));
  }
  return bars;
}

function chunkRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}
