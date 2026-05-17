import type { AudioClip, AudioVisualFrame, RecorderCommand, RecorderFailure, RecorderSubmission } from "@shared/types";

const TARGET_SAMPLE_RATE = 16_000;
const FRAME_REPORT_INTERVAL_MS = 50;
const VISUAL_BAR_COUNT = 9;
const FFT_SIZE = 2048;
const STOP_TAIL_CAPTURE_MS = 400;

declare global {
  interface Window {
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

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let stream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let visualizerFrame: number | null = null;
let monitorSession = 0;
let activeSessionId: string | null = null;
let previousInputDevice: number | null = null;
let startTime = 0;
let lastReportedAt = 0;
let smoothedBars = new Array(VISUAL_BAR_COUNT).fill(0.12);

window.__VAANI_RECORDER__.onStartRecording(({ sessionId }) => {
  void startRecording(sessionId);
});

window.__VAANI_RECORDER__.onStopRecording(({ sessionId }) => {
  void stopRecording(sessionId);
});

void window.__VAANI_RECORDER__.reportRecorderReady();

async function startRecording(sessionId: string): Promise<void> {
  try {
    await cleanup();
    activeSessionId = sessionId;
    resetSmoothedBars();
    previousInputDevice = await window.__VAANI_RECORDER__.prepareRecordingInput();

    const micDeviceId = await chooseMicDevice();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(micDeviceId ? { deviceId: micDeviceId } : {}),
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      }
    });

    await startWebAudioVisualizer(stream);

    const mimeType = preferredMimeType();
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    chunks = [];
    startTime = Date.now();

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.start(250);
    await window.__VAANI_RECORDER__.reportRecorderStarted(sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Microphone recording could not start.";
    await reportFailure(sessionId, `Microphone recording could not start: ${message}`);
    await cleanup();
  }
}

async function stopRecording(sessionId: string): Promise<void> {
  if (activeSessionId !== sessionId) {
    return;
  }

  const currentRecorder = recorder;
  if (!currentRecorder) {
    await reportFailure(sessionId, "Recording could not be finalized.");
    await cleanup();
    return;
  }

  resetVisualizer();

  const result = await new Promise<{ clip: AudioClip; duration: number } | null>((resolve) => {
    const finalize = async () => {
      try {
        const blob = new Blob(chunks, { type: currentRecorder.mimeType || "audio/webm" });
        if (blob.size === 0) {
          resolve(null);
          return;
        }

        const clip = await blobToClip(blob);
        const duration = Math.max(0, (Date.now() - startTime) / 1000);
        resolve({ clip, duration });
      } catch (error) {
        console.error("[vaani][recorder] stop failed:", error);
        resolve(null);
      } finally {
        await cleanup();
      }
    };

    currentRecorder.addEventListener("stop", () => {
      // Small delay to let any pending ondataavailable from stop() fire first
      setTimeout(() => {
        void finalize();
      }, 50);
    }, { once: true });

    if (currentRecorder.state !== "inactive") {
      void (async () => {
        await delay(STOP_TAIL_CAPTURE_MS);
        if (currentRecorder.state === "inactive") {
          return;
        }
        try {
          currentRecorder.requestData();
        } catch {
          // ignore if unsupported
        }
        currentRecorder.stop();
      })();
    } else {
      void finalize();
    }
  });

  if (!result) {
    await reportFailure(sessionId, "Recording could not be finalized.");
    return;
  }

  await window.__VAANI_RECORDER__.submitAudioClip({ sessionId, clip: result.clip });
}

async function reportFailure(sessionId: string, message: string): Promise<void> {
  await window.__VAANI_RECORDER__.reportRecorderFailure({ sessionId, message });
}

async function chooseMicDevice(): Promise<ConstrainDOMString | undefined> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(
      device => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default" && device.deviceId !== "communications"
    );
    const builtIn = inputs.find(device => {
      const label = device.label.toLowerCase();
      return label.includes("built-in") || label.includes("macbook") || label.includes("internal");
    }) ?? inputs[0];
    return builtIn?.deviceId ? { exact: builtIn.deviceId } : undefined;
  } catch {
    return undefined;
  }
}

async function startWebAudioVisualizer(inputStream: MediaStream): Promise<void> {
  try {
    monitorSession += 1;
    const session = monitorSession;
    audioContext = new AudioContext({ latencyHint: "interactive" });
    const source = audioContext.createMediaStreamSource(inputStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);

    if (audioContext.state !== "running") {
      await audioContext.resume();
    }

    if (audioContext.state !== "running") {
      return;
    }

    const dataArray = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (monitorSession !== session || !analyser) {
        return;
      }

      visualizerFrame = requestAnimationFrame(tick);
      analyser.getFloatTimeDomainData(dataArray);
      publishBars(buildBarsFromSamples(dataArray, VISUAL_BAR_COUNT));
    };

    tick();
  } catch (error) {
    console.warn("[vaani][recorder] Web Audio visualizer unavailable:", error);
  }
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

async function cleanup(): Promise<void> {
  resetVisualizer();

  if (recorder && recorder.state !== "inactive") {
    try {
      recorder.stop();
    } catch {
      // ignore
    }
  }
  recorder = null;
  chunks = [];
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  activeSessionId = null;

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

function resetVisualizer(): void {
  monitorSession += 1;
  if (visualizerFrame !== null) {
    cancelAnimationFrame(visualizerFrame);
    visualizerFrame = null;
  }
  if (analyser) {
    analyser.disconnect();
    analyser = null;
  }
  if (audioContext) {
    void audioContext.close();
    audioContext = null;
  }
}

function preferredMimeType(): string | null {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus"
  ];

  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return null;
}

function resetSmoothedBars(): void {
  smoothedBars = new Array(VISUAL_BAR_COUNT).fill(0.12);
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

async function blobToClip(blob: Blob): Promise<AudioClip> {
  const buffer = await blob.arrayBuffer();
  const context = new AudioContext();

  try {
    const decoded = await context.decodeAudioData(buffer.slice(0));
    const mono = mixToMono(decoded);
    const pcmData = resampleToTargetRate(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
    const rmsFrames = calculateRmsFrames(pcmData, TARGET_SAMPLE_RATE);

    return {
      pcmData: Array.from(pcmData),
      sampleRate: TARGET_SAMPLE_RATE,
      durationSeconds: pcmData.length / TARGET_SAMPLE_RATE,
      rmsFrames
    };
  } finally {
    await context.close();
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    return new Float32Array(buffer.getChannelData(0));
  }

  const mixed = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < buffer.length; index += 1) {
      mixed[index] = (mixed[index] ?? 0) + ((data[index] ?? 0) / buffer.numberOfChannels);
    }
  }
  return mixed;
}

function resampleToTargetRate(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) {
    return input;
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, input.length - 1);
    const interpolation = sourceIndex - left;
    output[index] = (input[left] ?? 0) * (1 - interpolation) + (input[right] ?? 0) * interpolation;
  }

  return output;
}

function calculateRmsFrames(pcmData: Float32Array, sampleRate: number): number[] {
  const frameSize = Math.max(1, Math.floor(sampleRate * 0.02));
  const rmsFrames: number[] = [];

  for (let index = 0; index < pcmData.length; index += frameSize) {
    const frame = pcmData.subarray(index, Math.min(index + frameSize, pcmData.length));
    if (frame.length === 0) continue;

    let sum = 0;
    for (let sampleIndex = 0; sampleIndex < frame.length; sampleIndex += 1) {
      const value = frame[sampleIndex] ?? 0;
      sum += value * value;
    }
    rmsFrames.push(Math.sqrt(sum / frame.length));
  }

  return rmsFrames;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
