import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioClip, AudioVisualFrame } from "@shared/types";

interface RecordingResult {
  clip: AudioClip;
  duration: number;
}

const TARGET_SAMPLE_RATE = 16_000;
const FRAME_REPORT_INTERVAL_MS = 50;
const VISUAL_BAR_COUNT = 9;
const FFT_SIZE = 2048;  // Larger buffer for better time-based visualization

export function useAudioRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const previousInputDeviceRef = useRef<number | null>(null);
  const visualizerFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const monitorSessionRef = useRef(0);
  const startTimeRef = useRef(0);
  const lastReportedAtRef = useRef(0);
  const [bars, setBars] = useState<number[]>(new Array(VISUAL_BAR_COUNT).fill(0));

  const publishBars = useCallback((nextBars: number[]) => {
    setBars(nextBars);

    const now = performance.now();
    if (now - lastReportedAtRef.current < FRAME_REPORT_INTERVAL_MS) {
      return;
    }

    lastReportedAtRef.current = now;
    const level = nextBars.reduce((sum, value) => sum + value, 0) / Math.max(1, nextBars.length);
    const frame: AudioVisualFrame = { level, bars: nextBars };
    void window.__VAANI_RECORDER__.reportAudioFrame(frame);
  }, []);

  const resetVisualizer = useCallback(() => {
    monitorSessionRef.current += 1;
    if (visualizerFrameRef.current) {
      cancelAnimationFrame(visualizerFrameRef.current);
      visualizerFrameRef.current = null;
    }
    
    // Cleanup AudioContext
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    setBars(new Array(VISUAL_BAR_COUNT).fill(0));
  }, []);

  // Fallback visualizer using sine wave (used only if Web Audio API fails)
  const startFallbackVisualizer = useCallback(() => {
    console.warn("[recorder] Using fallback sine wave visualizer");
    const sessionId = monitorSessionRef.current;
    const tick = () => {
      if (monitorSessionRef.current !== sessionId) {
        return;
      }

      const t = performance.now() / 240;
      const nextBars = Array.from({ length: VISUAL_BAR_COUNT }, (_, index) => {
        const wave = Math.sin(t + index * 0.8) * 0.5 + 0.5;
        return 0.18 + wave * 0.52;
      });
      publishBars(nextBars);
      visualizerFrameRef.current = requestAnimationFrame(tick);
    };

    visualizerFrameRef.current = requestAnimationFrame(tick);
  }, [publishBars]);

  // Primary visualizer using Web Audio API (AudioContext + AnalyserNode)
  const startWebAudioVisualizer = useCallback(async (stream: MediaStream): Promise<boolean> => {
    try {
      const sessionId = monitorSessionRef.current;
      // Visualizer started silently
      
      // Create audio context and analyser
      const audioCtx = new AudioContext({ latencyHint: "interactive" });
      audioContextRef.current = audioCtx;
      
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyserRef.current = analyser;
      
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);

      // CRITICAL: Analyser must be on a path to destination for Web Audio to pull samples
      const mutedGain = audioCtx.createGain();
      mutedGain.gain.value = 0;
      analyser.connect(mutedGain);
      mutedGain.connect(audioCtx.destination);
      
      // CRITICAL: AudioContext starts in 'suspended' state and must be resumed
      if (audioCtx.state !== "running") {
        await audioCtx.resume();
      }
      
      // Use time-domain data (waveform)
      const bufferLength = analyser.fftSize;
      const dataArray = new Float32Array(bufferLength);
      
      const tick = () => {
        if (monitorSessionRef.current !== sessionId) {
          return;
        }
        
        visualizerFrameRef.current = requestAnimationFrame(tick);
        
        const now = performance.now();
        if (now - lastReportedAtRef.current < FRAME_REPORT_INTERVAL_MS) {
          return;
        }
        
        // Get time-domain data (waveform samples)
        analyser.getFloatTimeDomainData(dataArray);
        
        // Build bars from samples
        const bars = buildBarsFromSamples(dataArray, VISUAL_BAR_COUNT);
        
        publishBars(bars);
      };
      
      tick();
      return true;
    } catch (err) {
      console.error("[recorder] Web Audio API failed:", err);
      return false;
    }
  }, [publishBars]);

  const startVisualizer = useCallback(async (stream: MediaStream) => {
    monitorSessionRef.current += 1;
    const success = await startWebAudioVisualizer(stream);
    if (!success) {
      console.warn("[recorder] Web Audio visualizer failed, using fallback");
      startFallbackVisualizer();
    }
  }, [startWebAudioVisualizer, startFallbackVisualizer]);

  const cleanup = useCallback(async () => {
    resetVisualizer();
    
    // Stop and cleanup recorder
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
    
    // Clear chunks
    chunksRef.current = [];
    
    // Stop all tracks
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    
    // Reset input device
    const previousInputDevice = previousInputDeviceRef.current;
    previousInputDeviceRef.current = null;
    if (previousInputDevice !== null) {
      try {
        await window.__VAANI_RECORDER__.restoreRecordingInput(previousInputDevice);
      } catch {
        // best-effort restore
      }
    }
  }, [resetVisualizer]);

  const startRecording = useCallback(async (): Promise<boolean> => {
    try {
      await cleanup();
      // Reset smoothing state for fresh waveform visualization
      resetSmoothedBars();
      previousInputDeviceRef.current = await window.__VAANI_RECORDER__.prepareRecordingInput();

      // Electron can enumerate devices with labels without prior getUserMedia.
      // Explicitly select the built-in mic to avoid capturing virtual/loopback
      // devices (e.g. BlackHole, Loopback) that may be the system default.
      let micDeviceId: ConstrainDOMString | undefined;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(
          d => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications"
        );
        const builtIn = inputs.find(d => {
          const label = d.label.toLowerCase();
          return label.includes("built-in") || label.includes("macbook") || label.includes("internal");
        }) ?? inputs[0];
        if (builtIn?.deviceId) micDeviceId = { exact: builtIn.deviceId };
      } catch {
        // fall back to system default
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(micDeviceId ? { deviceId: micDeviceId } : {}),
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      await startVisualizer(stream);

      const mimeType = preferredMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorderRef.current = recorder;
      startTimeRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.start(250);
      return true;
    } catch (error) {
      console.error("[vaani][audio] recorder start failed:", error);
      await cleanup();
      return false;
    }
  }, [cleanup, startVisualizer]);

  const stopRecording = useCallback(async (): Promise<RecordingResult | null> => {
    const recorder = recorderRef.current;
    if (!recorder) {
      await cleanup();
      return null;
    }

    resetVisualizer();

    return new Promise((resolve) => {
      const finalize = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          if (blob.size === 0) {
            resolve(null);
            return;
          }

          const clip = await blobToClip(blob);
          const duration = Math.max(0, (Date.now() - startTimeRef.current) / 1000);
          resolve({ clip, duration });
        } catch (error) {
          console.error("[vaani][audio] recorder stop failed:", error);
          resolve(null);
        } finally {
          await cleanup();
        }
      }

      recorder.addEventListener("stop", () => {
        setTimeout(() => {
          void finalize();
        }, 0);
      }, { once: true });

      if (recorder.state !== "inactive") {
        // Request final data before stopping
        try {
          recorder.requestData();
        } catch {
          // ignore if not supported
        }
        recorder.stop();
      } else {
        void finalize();
      }
    });
  }, [cleanup, resetVisualizer]);

  useEffect(() => () => {
    void cleanup();
  }, [cleanup]);

  return { bars, startRecording, stopRecording };
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



// Smoothing state for natural waveform animation
let smoothedBars: number[] = new Array(9).fill(0.12);
const SMOOTHING_FACTOR = 0.35;  // How quickly bars respond (higher = faster)
const MIN_BAR_HEIGHT = 0.12;
const MAX_BAR_HEIGHT = 1.0;

function resetSmoothedBars(): void {
  smoothedBars = new Array(9).fill(0.12);
}

function buildBarsFromSamples(samples: Float32Array, barCount: number): number[] {
  if (samples.length === 0) {
    // Decay bars when no samples
    smoothedBars = smoothedBars.map(b => Math.max(MIN_BAR_HEIGHT, b * 0.85));
    return [...smoothedBars];
  }

  const bucketSize = Math.max(1, Math.floor(samples.length / barCount));
  const rawBars = new Array(barCount).fill(MIN_BAR_HEIGHT);

  // Calculate global peak for normalization reference
  let globalPeak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const absSample = Math.abs(samples[i] ?? 0);
    if (absSample > globalPeak) globalPeak = absSample;
  }

  // Avoid division by zero and set minimum sensitivity
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

    // Combine RMS and peak, normalize against global peak for relative scaling
    // This makes the waveform responsive regardless of absolute volume
    const normalizedRms = rms / normalizer;
    const normalizedPeak = localPeak / normalizer;

    // Weight peak more heavily for snappier visual response
    const combined = normalizedRms * 0.4 + normalizedPeak * 0.6;

    // Apply exponential scaling for more dramatic visual range
    // sqrt makes quiet sounds more visible, pow(1.5) makes loud sounds pop
    const scaled = Math.pow(combined, 0.7);

    // Scale to full visual range with generous multiplier
    rawBars[barIndex] = MIN_BAR_HEIGHT + scaled * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT) * 1.2;
  }

  // Apply smoothing for natural animation (interpolate between current and target)
  for (let i = 0; i < barCount; i += 1) {
    const target = Math.min(MAX_BAR_HEIGHT, rawBars[i] ?? MIN_BAR_HEIGHT);
    const current = smoothedBars[i] ?? MIN_BAR_HEIGHT;
    // Rise faster than fall for punchy response
    const factor = target > current ? SMOOTHING_FACTOR * 1.5 : SMOOTHING_FACTOR * 0.8;
    smoothedBars[i] = current + (target - current) * factor;
  }

  return smoothedBars.map(b => Math.max(MIN_BAR_HEIGHT, Math.min(MAX_BAR_HEIGHT, b)));
}

async function blobToClip(blob: Blob): Promise<AudioClip> {
  const buffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    const decoded = await audioContext.decodeAudioData(buffer.slice(0));
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
    await audioContext.close();
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
    if (frame.length === 0) {
      continue;
    }

    let sum = 0;
    for (let sampleIndex = 0; sampleIndex < frame.length; sampleIndex += 1) {
      const value = frame[sampleIndex] ?? 0;
      sum += value * value;
    }
    rmsFrames.push(Math.sqrt(sum / frame.length));
  }

  return rmsFrames;
}
