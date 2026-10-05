import type { AudioInputDevice, MacOSPermissionState, AudioClip, AudioVisualFrame, RecorderCommand, RecorderConfig, RecorderFailure, RecorderSubmission } from "@shared/types";
import { chooseRecorderDeviceId } from "./deviceSelection";
import {
  PcmRingBuffer,
  PRE_ROLL_MS,
  mergePcmChunks,
  pcmToAudioClip,
  trimLeadingSilence,
} from "./pcmUtils";
import pcmWorkletUrl from "./pcmWorklet.ts?url";
import { rendererQuietThreshold, trailingRms, waitForRendererDrain } from "@shared/recorderTail";

const FRAME_REPORT_INTERVAL_MS = 50;
const VISUAL_BAR_COUNT = 9;
const DEFAULT_INPUT_SAMPLE_RATE = 48_000;
const ECHO_CANCELLATION = true;

declare global {
  interface Window {
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
let previousInputDevice: number | null = null;
let currentConfig: RecorderConfig = { preWarmMic: false };
let captureConfigKey: string | null = null;
let capturePromise: Promise<void> | null = null;
let sessionChunks: Float32Array[] = [];
let lastFrameAt = 0;
let lastLoudFrameAt = 0;
let quietThreshold = 0;
let frameRms: number[] = [];
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

async function startRecording({ sessionId, config }: RecorderCommand): Promise<void> {
  try {
    currentConfig = normalizeConfig(config);
    sessionChunks = [];
    lastFrameAt = 0;
    lastLoudFrameAt = 0;
    quietThreshold = 0;
    frameRms = [];
    resetSmoothedBars();
    previousInputDevice = await window.__VAANI_RECORDER__.prepareRecordingInput();

    await ensureWarmCapture(currentConfig);

    const sampleRate = audioContext?.sampleRate ?? DEFAULT_INPUT_SAMPLE_RATE;
    const preRoll = trimLeadingSilence(ringBuffer.snapshot(Math.floor(sampleRate * PRE_ROLL_MS / 1000)), sampleRate);
    if (preRoll.length > 0) {
      sessionChunks.push(preRoll);
    }

    activeSessionId = sessionId;
    await window.__VAANI_RECORDER__.reportRecorderStarted(sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Microphone recording could not start.";
    await reportFailure(sessionId, `Microphone recording could not start: ${message}`);
    await cleanupSession();
    if (!currentConfig.preWarmMic) {
      await shutdownWarmCapture();
    }
  }
}

async function stopRecording(sessionId: string): Promise<void> {
  if (activeSessionId !== sessionId) {
    return;
  }

  const stopRequestedAt = Date.now();
  quietThreshold = rendererQuietThreshold(frameRms);
  await waitForRendererDrain(stopRequestedAt, () => lastLoudFrameAt, () => activeSessionId === sessionId);
  if (activeSessionId !== sessionId) return;

  const inputRate = audioContext?.sampleRate ?? DEFAULT_INPUT_SAMPLE_RATE;
  const chunksAtStop = sessionChunks.slice();
  const lastFrameAfterStopMs = lastFrameAt ? lastFrameAt - stopRequestedAt : 0;
  await cleanupSession();

  if (!currentConfig.preWarmMic) {
    await shutdownWarmCapture();
  }

  const clip = finalizeClip(chunksAtStop, inputRate);
  if (!clip || clip.pcmData.length === 0) {
    await reportFailure(sessionId, "Recording could not be finalized.");
    return;
  }

  await window.__VAANI_RECORDER__.submitAudioClip({ sessionId, clip, tailMetrics: {
    lastFrameAfterStopMs,
    trailingRms: trailingRms(mergePcmChunks(chunksAtStop), inputRate),
  } });
}

async function abortRecording(sessionId: string): Promise<void> {
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
  if (!currentConfig.preWarmMic || activeSessionId) {
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
      echoCancellation: ECHO_CANCELLATION,
      noiseSuppression: false,
      autoGainControl: true,
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
  ringBuffer.append(samples);

  if (!activeSessionId) {
    return;
  }

  sessionChunks.push(samples.slice());
  lastFrameAt = Date.now();
  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  if (samples.length > 0) {
    const rms = Math.sqrt(sumSquares / samples.length);
    if (quietThreshold === 0) frameRms.push(rms);
    if (rms >= quietThreshold) lastLoudFrameAt = lastFrameAt;
  }
  publishBars(buildBarsFromSamples(samples, VISUAL_BAR_COUNT));
}

async function handleCaptureEnded(): Promise<void> {
  const failedSessionId = activeSessionId;
  await shutdownWarmCapture();
  if (failedSessionId) {
    await reportFailure(failedSessionId, "Microphone input stopped. Check your selected microphone.");
    await cleanupSession();
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
  sessionChunks = [];
  frameRms = [];
  quietThreshold = 0;

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

async function shutdownWarmCapture(): Promise<void> {
  if (processorNode) {
    processorNode.disconnect();
    if ("port" in processorNode) {
      processorNode.port.onmessage = null;
    } else {
      processorNode.onaudioprocess = null;
    }
    processorNode = null;
  }

  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }

  if (audioContext) {
    const context = audioContext;
    audioContext = null;
    try {
      await context.close();
    } catch {
      // ignore
    }
  }

  stream?.getTracks().forEach((track) => {
    track.onended = null;
    track.onmute = null;
    track.stop();
  });
  stream = null;
  captureConfigKey = null;
  ringBuffer.clear();
}

function recorderConfigKey(config: RecorderConfig): string {
  return `${config.preWarmMic ? "warm" : "ondemand"}:${config.micDeviceId ?? ""}`;
}

function normalizeConfig(config: RecorderConfig | undefined): RecorderConfig {
  return {
    micDeviceId: config?.micDeviceId,
    preWarmMic: config?.preWarmMic ?? false,
    captureBackend: config?.captureBackend ?? "renderer",
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
  let globalPeak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    globalPeak = Math.max(globalPeak, Math.abs(samples[index] ?? 0));
  }

  const normalizer = Math.max(0.01, globalPeak);
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
    const combined = (rms / normalizer) * 0.4 + (localPeak / normalizer) * 0.6;
    rawBars[barIndex] = 0.12 + Math.pow(combined, 0.7) * 1.056;
  }

  for (let index = 0; index < barCount; index += 1) {
    const target = Math.min(1, rawBars[index] ?? 0.12);
    const current = smoothedBars[index] ?? 0.12;
    const factor = target > current ? 0.525 : 0.28;
    smoothedBars[index] = current + (target - current) * factor;
  }

  return smoothedBars.map(bar => Math.max(0.12, Math.min(1, bar)));
}
