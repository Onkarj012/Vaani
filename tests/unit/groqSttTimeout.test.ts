import { describe, expect, it } from "vitest";
import { groqRequestTimeoutMs } from "@main/providers/groq/groqStt";
import { getTranscriptionTimeoutMs } from "@main/transcription";

describe("groqRequestTimeoutMs", () => {
  it("keeps short clips fast and gives long uploads time to finish", () => {
    expect(groqRequestTimeoutMs(2)).toBe(6_400);
    // A 5-minute WAV is about 9.6 MB, over 7 s to upload at 10 Mbps.
    expect(groqRequestTimeoutMs(300)).toBe(66_000);
  });

  it("stays inside the session's transcription budget", () => {
    for (const seconds of [30, 120, 300, 590]) {
      const clip = { pcmData: new Array(16_000 * seconds).fill(0.1), sampleRate: 16_000, durationSeconds: seconds, rmsFrames: [0.1] };
      expect(groqRequestTimeoutMs(seconds)).toBeLessThan(getTranscriptionTimeoutMs(clip));
    }
  });
});
