import { waveformHeight } from "@renderer/recorder/waveform";
import type { AudioInputDevice, MacOSPermissionState, AudioClip, AudioVisualFrame, CaptureTrackSettings, RecorderCommand, RecorderConfig, RecorderFailure, RecorderSubmission } from "@shared/types";
import { captureProcessingConstraints, chooseRecorderDeviceId } from "./deviceSelection";
import {
  PcmRingBuffer,
  PRE_ROLL_MS,
  mergePcmChunks,
  pcmToAudioClip,
  trimLeadingSilence,
} from "./pcmUtils";
import pcmWorkletUrl from "./pcmWorklet.ts?url";
import { quietThresholdFromNoise, trailingRms, waitForRendererDrain } from "@shared/recorderTail";

const FRAME_REPORT_INTERVAL_MS = 50;
const VISUAL_BAR_COUNT = 9;
const DEFAULT_INPUT_SAMPLE_RATE = 48_000;
// Bar height shown while a session is paused.
const PAUSED_BAR_LEVEL = 0.12;

declare global {
  interface Window {
    __VAANI_RECORDER__: {
      onStartRecording: (cb: (payload: RecorderCommand) => void) => () => void;
      onStopRecording: (cb: (payload: RecorderCommand) => void) => () => void;
      onAbortRecording: (cb: (payload: RecorderCommand) => void) => () => void;
      onSuspendRecording: (cb: (payload: RecorderCommand) => void) => () => void;
      onResumeRecording: (cb: (payload: RecorderCommand) => void) => () => void;
      onPauseCapture: (cb: (payload: RecorderCommand) => void) => () => void;
      onResumeCapture: (cb: (payload: RecorderCommand) => void) => () => void;
      submitAudioClip: (payload: RecorderSubmission) => Promise<void>;
      reportRecorderReady: () => Promise<void>;
      reportRecorderStarted: (sessionId: string) => Promise<void>;
      reportAudioFrame: (frame: AudioVisualFrame) => Promise<void>;
  reportRecorderFailure: (payload: RecorderFailure) => Promise<void>;
  reportRecorderSuspended: (payload: { sessionId: string; ok: boolean; partialClip?: AudioClip; message?: string }) => Promise<void>;
      prepareRecordingInput: () => Promise<number | null>;
      restoreRecordingInput: (deviceId: number | null) => Promise<boolean>;
      getRecorderConfig: () => Promise<RecorderConfig>;
      listAudioInputDevices: () => Promise<AudioInputDevice[]>;
      requestMicrophonePermission: () => Promise<MacOSPermissionState>;
      onRecorderConfigChanged: (cb: (payload: RecorderConfig) => void) => () => void;
    };
  }
}

type PcmProcessorNode = AudioWorkletNode | ScriptProcessorNode;

let stream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: PcmProcessorNode | null = null;
let ringBuffer = new PcmRingBuffer(Math.floor(DEFAULT_INPUT_SAMPLE_RATE * PRE_ROLL_MS / 1000));
let activeSessionId: string | null = null;
let paused = false;
const pendingStarts = new Map<string, { cancelled: boolean }>();
// Starts run one at a time, so a cancelled start never cleans up capture a newer start is using.
let startQueue: Promise<void> = Promise.resolve();
let previousInputDevice: number | null = null;
let currentConfig: RecorderConfig = { preWarmMic: false };
let captureConfigKey: string | null = null;
let capturePromise: Promise<void> | null = null;
let sessionChunks: Float32Array[] = [];
let lastFrameAt = 0;
let lastLoudFrameAt = 0;
// Each frame's arrival time and RMS for the current session. The stop tail reads its quiet level from these.
let sessionFrames: { at: number; rms: number }[] = [];
let quietThreshold: number | null = null;
// Mic teardown of the last session. It runs while that clip is sent, and the next start waits for it.
let teardown: Promise<void> = Promise.resolve();
let awaitingFirstFrame = false;
let lastReportedAt = 0;
let smoothedBars = new Array(VISUAL_BAR_COUNT).fill(0.12);

window.__VAANI_RECORDER__.onStartRecording((command) => {
  void startRecording(command);
});

window.__VAANI_RECORDER__.onStopRecording(({ sessionId }) => {
  void stopRecording(sessionId);
});

window.__VAANI_RECORDER__.onAbortRecording(({ sessionId }) => {
  void abortRecording(sessionId);
});

window.__VAANI_RECORDER__.onSuspendRecording(({ sessionId }) => {
  void suspendRecording(sessionId);
});

window.__VAANI_RECORDER__.onResumeRecording(() => {
  void resumeAfterLifecycle();
});

window.__VAANI_RECORDER__.onPauseCapture(({ sessionId }) => {
  if (activeSessionId === sessionId) paused = true;
});

window.__VAANI_RECORDER__.onResumeCapture(({ sessionId }) => {
  if (activeSessionId === sessionId) paused = false;
});

window.__VAANI_RECORDER__.onRecorderConfigChanged((config) => {
  currentConfig = normalizeConfig(config);
  void rebuildWarmCapture();
});

void initializeRecorder();

async function initializeRecorder(): Promise<void> {
  try {
    currentConfig = normalizeConfig(await window.__VAANI_RECORDER__.getRecorderConfig());
  } catch {
    currentConfig = { preWarmMic: false };
  }

  await window.__VAANI_RECORDER__.reportRecorderReady();

  if (currentConfig.preWarmMic) {
    try {
      await ensureWarmCapture(currentConfig);
    } catch (error) {
      console.warn("[vaani][recorder] prewarm unavailable:", error);
      await shutdownWarmCapture();
    }
  }
}

// Open capture unless the session is aborted while its input is being prepared.
async function startRecording({ sessionId, config }: RecorderCommand): Promise<void> {
  const start = { cancelled: false };
  pendingStarts.set(sessionId, start);
  const previousStart = startQueue;
  let finishStart = () => {};
  startQueue = new Promise<void>((resolve) => { finishStart = resolve; });
  await previousStart;
  try {
    await teardown;
    if (start.cancelled) return;
    currentConfig = normalizeConfig(config);
    sessionChunks = [];
    paused = false;
    lastFrameAt = 0;
    lastLoudFrameAt = 0;
    sessionFrames = [];
    quietThreshold = null;
    resetSmoothedBars();
    previousInputDevice = await window.__VAANI_RECORDER__.prepareRecordingInput();

    if (!start.cancelled) await ensureWarmCapture(currentConfig);
    if (start.cancelled) {
      await cleanupSession();
      await shutdownWarmCapture();
      return;
    }

    const sampleRate = audioContext?.sampleRate ?? DEFAULT_INPUT_SAMPLE_RATE;
    const preRoll = trimLeadingSilence(ringBuffer.snapshot(Math.floor(sampleRate * PRE_ROLL_MS / 1000)), sampleRate);
    if (preRoll.length > 0) {
      sessionChunks.push(preRoll);
    }

    pendingStarts.delete(sessionId);
    activeSessionId = sessionId;
    awaitingFirstFrame = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Microphone recording could not start.";
    if (!start.cancelled) await reportFailure(sessionId, `Microphone recording could not start: ${message}`);
    await cleanupSession();
    if (start.cancelled || !currentConfig.preWarmMic) {
      await shutdownWarmCapture();
    }
  } finally {
    if (pendingStarts.get(sessionId) === start) pendingStarts.delete(sessionId);
    finishStart();
  }
}

async function stopRecording(sessionId: string): Promise<void> {
  if (activeSessionId !== sessionId) {
    return;
  }

  const stopRequestedAt = Date.now();
  quietThreshold = quietThresholdFromNoise(sessionFrames.map((frame) => frame.rms));
  lastLoudFrameAt = lastLoudFrameAtOrAbove(quietThreshold);
  await waitForRendererDrain(stopRequestedAt, () => lastLoudFrameAt, () => activeSessionId === sessionId);
  if (activeSessionId !== sessionId) return;

  const inputRate = audioContext?.sampleRate ?? DEFAULT_INPUT_SAMPLE_RATE;
  const chunksAtStop = sessionChunks.slice();
  const lastFrameAfterStopMs = lastFrameAt ? lastFrameAt - stopRequestedAt : 0;
  const captureSettings = readCaptureSettings(stream);
  // Mic teardown runs while the clip is finalized and sent. The submit call waits for the whole dictation, so it can't go first.
  // The warm-mic setting is read after cleanup, so a change made meanwhile still closes the mic.
  teardown = (async () => {
    await cleanupSession();
    if (!currentConfig.preWarmMic) await shutdownWarmCapture();
  })().catch(() => undefined);

  const clip = finalizeClip(chunksAtStop, inputRate);
  if (!clip || clip.pcmData.length === 0) {
    await reportFailure(sessionId, "Recording could not be finalized.");
    return;
  }

  await window.__VAANI_RECORDER__.submitAudioClip({ sessionId, clip, captureSettings, tailMetrics: {
    lastFrameAfterStopMs,
    trailingRms: trailingRms(mergePcmChunks(tailChunks(chunksAtStop, Math.floor(inputRate * 0.3))), inputRate),
  } });
}

// Arrival time of the newest frame at or above the quiet level, or 0 when none is.
function lastLoudFrameAtOrAbove(threshold: number): number {
  for (let index = sessionFrames.length - 1; index >= 0; index -= 1) {
    const frame = sessionFrames[index];
    if (frame && frame.rms >= threshold) return frame.at;
  }
  return 0;
}

// The fewest final chunks that hold at least the given number of samples, so the tail RMS skips merging the whole clip.
function tailChunks(chunks: readonly Float32Array[], sampleCount: number): Float32Array[] {
  const tail: Float32Array[] = [];
  let total = 0;
  for (let index = chunks.length - 1; index >= 0 && total < sampleCount; index -= 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    tail.unshift(chunk);
    total += chunk.length;
  }
  return tail;
}

// Reads the processing flags the mic track reports, so traces show what the browser applied.
function readCaptureSettings(mediaStream: MediaStream | null): CaptureTrackSettings | undefined {
  const settings = mediaStream?.getAudioTracks()[0]?.getSettings();
  if (!settings) return undefined;
  const captured: CaptureTrackSettings = {};
  if (typeof settings.echoCancellation === "boolean") captured.echoCancellation = settings.echoCancellation;
  if (typeof settings.autoGainControl === "boolean") captured.autoGainControl = settings.autoGainControl;
  if (typeof settings.noiseSuppression === "boolean") captured.noiseSuppression = settings.noiseSuppression;
  return captured;
}

// Cancel an opening session or shut down capture that is already recording.
async function abortRecording(sessionId: string): Promise<void> {
  const pending = pendingStarts.get(sessionId);
  if (pending) {
    pending.cancelled = true;
    return;
  }
  if (activeSessionId !== sessionId) return;
  await cleanupSession();
  await shutdownWarmCapture();
}

async function suspendRecording(sessionId: string): Promise<void> {
  const suspendedSessionId = activeSessionId;
  if (suspendedSessionId !== sessionId) {
    await shutdownWarmCapture();
    return;
  }
  try {
    const clip = finalizeClip(sessionChunks.slice(), audioContext?.sampleRate ?? DEFAULT_INPUT_SAMPLE_RATE);
    await cleanupSession();
    await shutdownWarmCapture();
    await window.__VAANI_RECORDER__.reportRecorderSuspended({
      sessionId,
      ok: true,
      ...(clip ? { partialClip: clip } : {}),
    });
  } catch (error) {
    await window.__VAANI_RECORDER__.reportRecorderSuspended({
      sessionId,
      ok: false,
      message: error instanceof Error ? error.message : "Renderer capture could not be suspended.",
    });
  }
}

async function resumeAfterLifecycle(): Promise<void> {
  if (!currentConfig.preWarmMic) return;
  try {
    await ensureWarmCapture(currentConfig);
  } catch (error) {
    console.warn("[vaani][recorder] lifecycle resume unavailable:", error);
    await shutdownWarmCapture();
  }
}

async function reportFailure(sessionId: string, message: string): Promise<void> {
  await window.__VAANI_RECORDER__.reportRecorderFailure({ sessionId, message });
}

async function rebuildWarmCapture(): Promise<void> {
  await teardown;
  if (activeSessionId) return;
  // Turning the warm mic off closes an idle one instead of leaving it open.
  if (!currentConfig.preWarmMic) {
    await shutdownWarmCapture();
    return;
  }

  await shutdownWarmCapture();

  try {
    await ensureWarmCapture(currentConfig);
  } catch (error) {
    console.warn("[vaani][recorder] config prewarm unavailable:", error);
    await shutdownWarmCapture();
  }
}

async function ensureWarmCapture(config: RecorderConfig): Promise<void> {
  const configKey = recorderConfigKey(config);
  if (stream && audioContext && captureConfigKey === configKey) {
    return;
  }

  if (capturePromise) {
    await capturePromise;
    if (stream && audioContext && captureConfigKey === configKey) {
      return;
    }
  }

  capturePromise = openCapture(config).finally(() => {
    capturePromise = null;
  });
  return capturePromise;
}

async function openCapture(config: RecorderConfig): Promise<void> {
  await shutdownWarmCapture();

  const micDeviceId = await chooseMicDevice(config.micDeviceId);
  const nextStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: micDeviceId },
      channelCount: 1,
      ...captureProcessingConstraints(config.captureProcessing),
    },
  });

  stream = nextStream;
  captureConfigKey = recorderConfigKey(config);
  await startPcmCapture(nextStream);
}

/** Resolve an exact microphone ID after permission recovery and native/browser validation. */
async function chooseMicDevice(preferredDeviceId: string | undefined): Promise<string> {
  return chooseRecorderDeviceId({
    enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
    listAudioInputDevices: () => window.__VAANI_RECORDER__.listAudioInputDevices(),
    requestMicrophonePermission: () => window.__VAANI_RECORDER__.requestMicrophonePermission(),
  }, preferredDeviceId);
}

async function startPcmCapture(inputStream: MediaStream): Promise<void> {
  const context = new AudioContext({ latencyHint: "interactive" });
  audioContext = context;
  ringBuffer = new PcmRingBuffer(Math.floor(context.sampleRate * PRE_ROLL_MS / 1000));

  const source = context.createMediaStreamSource(inputStream);
  sourceNode = source;

  try {
    await context.audioWorklet.addModule(pcmWorkletUrl);
    const worklet = new AudioWorkletNode(context, "vaani-pcm-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      handlePcmData(event.data);
    };
    source.connect(worklet);
    processorNode = worklet;
  } catch (error) {
    console.warn("[vaani][recorder] AudioWorklet unavailable, using ScriptProcessor:", error);
    const scriptProcessor = context.createScriptProcessor(2048, 1, 1);
    scriptProcessor.onaudioprocess = (event) => {
      handlePcmData(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(scriptProcessor);
    scriptProcessor.connect(context.destination);
    processorNode = scriptProcessor;
  }

  if (context.state !== "running") {
    await context.resume();
  }

  inputStream.getTracks().forEach((track) => {
    track.onended = () => {
      void handleCaptureEnded();
    };
    track.onmute = () => {
      if (activeSessionId) {
        void reportFailure(activeSessionId, "Microphone input stopped. Check your selected microphone.");
      }
    };
  });
}

function handlePcmData(samples: Float32Array): void {
  // Paused speech stays out of the pre-roll too, or the next recording would import it.
  if (!paused) ringBuffer.append(samples);

  if (!activeSessionId) {
    return;
  }

  // Started means audio is arriving, not that the device opened.
  if (awaitingFirstFrame && samples.length > 0) {
    awaitingFirstFrame = false;
    void window.__VAANI_RECORDER__.reportRecorderStarted(activeSessionId);
  }
  lastFrameAt = Date.now();
  // Paused frames keep the watchdog fed but never reach the clip.
  if (paused) {
    publishBars(new Array(VISUAL_BAR_COUNT).fill(PAUSED_BAR_LEVEL));
    return;
  }

  sessionChunks.push(samples.slice());
  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  if (samples.length > 0) {
    const rms = Math.sqrt(sumSquares / samples.length);
    sessionFrames.push({ at: lastFrameAt, rms });
    // The quiet level is set at stop. Frames arriving during the tail wait are judged against it.
    if (quietThreshold !== null && rms >= quietThreshold) lastLoudFrameAt = lastFrameAt;
  }
  publishBars(buildBarsFromSamples(samples, VISUAL_BAR_COUNT));
}

async function handleCaptureEnded(): Promise<void> {
  const failedSessionId = activeSessionId;
  await shutdownWarmCapture();
  if (failedSessionId) {
    await reportFailure(failedSessionId, "Microphone input stopped. Check your selected microphone.");
    // A newer session may have started during the shutdown. Leave it alone.
    if (activeSessionId === failedSessionId) await cleanupSession();
  }
}

function finalizeClip(chunks: Float32Array[], inputRate: number): AudioClip | null {
  const merged = mergePcmChunks(chunks);
  if (merged.length === 0) {
    return null;
  }

  return pcmToAudioClip(merged, inputRate);
}

function publishBars(nextBars: number[]): void {
  const now = performance.now();
  if (now - lastReportedAt < FRAME_REPORT_INTERVAL_MS) {
    return;
  }

  lastReportedAt = now;
  const level = nextBars.reduce((sum, value) => sum + value, 0) / Math.max(1, nextBars.length);
  void window.__VAANI_RECORDER__.reportAudioFrame({ level, bars: nextBars });
}

async function cleanupSession(): Promise<void> {
  activeSessionId = null;
  awaitingFirstFrame = false;
  sessionChunks = [];
  ringBuffer.clear();
  paused = false;
  sessionFrames = [];
  quietThreshold = null;

  if (previousInputDevice !== null) {
    const deviceId = previousInputDevice;
    previousInputDevice = null;
    try {
      await window.__VAANI_RECORDER__.restoreRecordingInput(deviceId);
    } catch {
      // best effort
    }
  }
}

// Takes the current capture out of the globals first, then closes only that capture.
// A start that runs while close() is pending opens its own stream, which this never touches.
async function shutdownWarmCapture(): Promise<void> {
  const processor = processorNode;
  const source = sourceNode;
  const context = audioContext;
  const ownedStream = stream;
  processorNode = null;
  sourceNode = null;
  audioContext = null;
  stream = null;
  captureConfigKey = null;
  ringBuffer.clear();

  if (processor) {
    processor.disconnect();
    if ("port" in processor) {
      processor.port.onmessage = null;
    } else {
      processor.onaudioprocess = null;
    }
  }
  source?.disconnect();
  ownedStream?.getTracks().forEach((track) => {
    track.onended = null;
    track.onmute = null;
    track.stop();
  });
  if (context) {
    try {
      await context.close();
    } catch {
      // ignore
    }
  }
}

function recorderConfigKey(config: RecorderConfig): string {
  return `${config.preWarmMic ? "warm" : "ondemand"}:${config.micDeviceId ?? ""}:${config.captureProcessing ?? "default"}`;
}

function normalizeConfig(config: RecorderConfig | undefined): RecorderConfig {
  return {
    micDeviceId: config?.micDeviceId,
    preWarmMic: config?.preWarmMic ?? false,
    captureBackend: config?.captureBackend ?? "renderer",
    captureProcessing: config?.captureProcessing ?? "default",
  };
}

function resetSmoothedBars(): void {
  smoothedBars = new Array(VISUAL_BAR_COUNT).fill(0.12);
  lastReportedAt = 0;
}

function buildBarsFromSamples(samples: Float32Array, barCount: number): number[] {
  if (samples.length === 0) {
    smoothedBars = smoothedBars.map(bar => Math.max(0.12, bar * 0.85));
    return [...smoothedBars];
  }

  const bucketSize = Math.max(1, Math.floor(samples.length / barCount));
  const rawBars = new Array(barCount).fill(0.12);
  for (let barIndex = 0; barIndex < barCount; barIndex += 1) {
    const start = barIndex * bucketSize;
    const end = Math.min(samples.length, start + bucketSize);
    if (start >= end) continue;

    let sumSquares = 0;
    let localPeak = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const sample = samples[sampleIndex] ?? 0;
      sumSquares += sample * sample;
      localPeak = Math.max(localPeak, Math.abs(sample));
    }

    const rms = Math.sqrt(sumSquares / (end - start));
    rawBars[barIndex] = waveformHeight(rms * 0.4 + localPeak * 0.6);
  }

  for (let index = 0; index < barCount; index += 1) {
    const target = Math.min(1, rawBars[index] ?? 0.12);
    const current = smoothedBars[index] ?? 0.12;
    const factor = target > current ? 0.525 : 0.28;
    smoothedBars[index] = current + (target - current) * factor;
  }

  return smoothedBars.map(bar => Math.max(0.12, Math.min(1, bar)));
}
