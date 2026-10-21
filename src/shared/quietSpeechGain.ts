// Auto gain for whispered or very quiet clips, applied before STT. Input must be
// 16 kHz mono, as produced by pcmToAudioClip, which applies the gain.

const FRAME_SAMPLES = 320; // 20 ms at 16 kHz
const QUIET_PEAK_CEILING = 0.25; // about -12 dBFS; louder clips are left alone
const TARGET_PEAK = 0.7;
const MAX_GAIN = 20; // +26 dB, the same ceiling as before; the voiced floor keeps room noise out
// Frames below this are room noise, not speech. Same floor as the low-speech check in transcriptQuality.
const SILENCE_FLOOR_RMS = 0.002;

// Gain that lifts a quiet clip toward a usable peak. 1 for loud clips and for room noise.
export function quietSpeechGain(samples: Float32Array): number {
  const peak = peakOf(samples);
  if (peak === 0 || peak >= QUIET_PEAK_CEILING || voicedRms(samples) < SILENCE_FLOOR_RMS) return 1;
  return Math.min(MAX_GAIN, TARGET_PEAK / peak);
}

// Largest absolute sample value in the clip.
function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index] ?? 0));
  }
  return peak;
}

// RMS over the 20 ms frames that carry energy. Zero when there are none.
function voicedRms(samples: Float32Array): number {
  let sumSquares = 0;
  let count = 0;
  for (let offset = 0; offset < samples.length; offset += FRAME_SAMPLES) {
    const end = Math.min(offset + FRAME_SAMPLES, samples.length);
    let frameSquares = 0;
    for (let index = offset; index < end; index += 1) {
      frameSquares += (samples[index] ?? 0) ** 2;
    }
    if (Math.sqrt(frameSquares / (end - offset)) >= SILENCE_FLOOR_RMS) {
      sumSquares += frameSquares;
      count += end - offset;
    }
  }
  return count === 0 ? 0 : Math.sqrt(sumSquares / count);
}
