// Pre-STT speech gate: rejects clips with no speech-like contrast so silence
// never reaches Whisper (which hallucinates phrases on silent audio). Operates
// on the clip's 20ms RMS frames and adapts to the clip's own noise floor, so a
// quiet room and a boosted noise floor are both handled without fixed-level
// assumptions. The gate only rejects — it never trims audio.

export const SPEECH_GATE_FRAME_MS = 20;

const MIN_ENTER_THRESHOLD = 0.003;
const MIN_EXIT_THRESHOLD = 0.0018;
const ENTER_FLOOR_MULTIPLIER = 2.5;
const ENTER_FLOOR_OFFSET = 0.002;
const EXIT_RATIO = 0.55;
const RELEASE_FRAMES = 3;
const MIN_LONGEST_RUN_MS = 120;
const MIN_TOTAL_SPEECH_MS = 160;
// Continuous loud speech has no quiet frames, so the adaptive floor rises to
// the speech level itself. Above this floor the clip is speech-dominant and
// passes outright.
const SPEECH_DOMINANT_FLOOR = 0.008;

export interface SpeechGateResult {
  pass: boolean;
  reason: "speech" | "speech-dominant" | "no-frames" | "no-speech-contrast";
  noiseFloor: number;
  enterThreshold: number;
  longestRunMs: number;
  totalSpeechMs: number;
}

export function evaluateSpeechGate(rmsFrames: number[], frameMs = SPEECH_GATE_FRAME_MS): SpeechGateResult {
  if (rmsFrames.length === 0) {
    return { pass: false, reason: "no-frames", noiseFloor: 0, enterThreshold: MIN_ENTER_THRESHOLD, longestRunMs: 0, totalSpeechMs: 0 };
  }

  const sorted = [...rmsFrames].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;

  if (noiseFloor >= SPEECH_DOMINANT_FLOOR) {
    const totalMs = rmsFrames.length * frameMs;
    return { pass: true, reason: "speech-dominant", noiseFloor, enterThreshold: noiseFloor, longestRunMs: totalMs, totalSpeechMs: totalMs };
  }

  const enter = Math.max(MIN_ENTER_THRESHOLD, noiseFloor * ENTER_FLOOR_MULTIPLIER, noiseFloor + ENTER_FLOOR_OFFSET);
  const exit = Math.max(MIN_EXIT_THRESHOLD, enter * EXIT_RATIO);

  let inSpeech = false;
  let belowCount = 0;
  let runFrames = 0;
  let longestRun = 0;
  let totalFrames = 0;

  const endRun = () => {
    longestRun = Math.max(longestRun, runFrames);
    totalFrames += runFrames;
    inSpeech = false;
    runFrames = 0;
    belowCount = 0;
  };

  for (const frame of rmsFrames) {
    if (!inSpeech) {
      if (frame >= enter) {
        inSpeech = true;
        runFrames = 1;
        belowCount = 0;
      }
      continue;
    }
    if (frame < exit) {
      belowCount += 1;
      if (belowCount >= RELEASE_FRAMES) {
        runFrames = Math.max(0, runFrames - (RELEASE_FRAMES - 1));
        endRun();
        continue;
      }
    } else {
      belowCount = 0;
    }
    runFrames += 1;
  }
  if (inSpeech) endRun();

  const longestRunMs = longestRun * frameMs;
  const totalSpeechMs = totalFrames * frameMs;
  const pass = longestRunMs >= MIN_LONGEST_RUN_MS && totalSpeechMs >= MIN_TOTAL_SPEECH_MS;

  return { pass, reason: pass ? "speech" : "no-speech-contrast", noiseFloor, enterThreshold: enter, longestRunMs, totalSpeechMs };
}
