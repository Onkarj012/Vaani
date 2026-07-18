import { describe, expect, it } from "vitest";
import { barScale, envelopeStep, BAR_MAX_HEIGHT, BAR_MIN_HEIGHT, BAR_GAIN } from "@renderer/overlay/waveform";

describe("barScale", () => {
  it("clamps quiet levels to the minimum visible bar height", () => {
    expect(barScale(0)).toBeCloseTo(BAR_MIN_HEIGHT / BAR_MAX_HEIGHT);
    expect(barScale(0.01)).toBeCloseTo(BAR_MIN_HEIGHT / BAR_MAX_HEIGHT);
  });

  it("clamps loud levels to the maximum bar height", () => {
    // BAR_GAIN=18 means v must reach ~1.22 (22/18) before the bar maxes out.
    expect(barScale(BAR_MAX_HEIGHT / BAR_GAIN)).toBe(1);
    expect(barScale(5)).toBe(1);
  });

  it("scales linearly with gain in between", () => {
    const v = 0.5;
    expect(barScale(v)).toBeCloseTo((v * BAR_GAIN) / BAR_MAX_HEIGHT);
  });
});

describe("envelopeStep", () => {
  it("moves toward a rising target faster than a falling one", () => {
    const attackStep = envelopeStep(0.1, 1);
    const releaseStep = envelopeStep(1, 0.1);
    const attackFraction = (attackStep - 0.1) / (1 - 0.1);
    const releaseFraction = (1 - releaseStep) / (1 - 0.1);
    expect(attackFraction).toBeGreaterThan(releaseFraction);
  });

  it("converges to the target after repeated steps without overshooting", () => {
    let v = 0.08;
    for (let i = 0; i < 60; i++) v = envelopeStep(v, 1);
    expect(v).toBe(1);
  });

  it("snaps exactly to the target once within epsilon instead of approaching forever", () => {
    // Already effectively at target — should settle immediately, not asymptote.
    const next = envelopeStep(0.9999, 1);
    expect(next).toBe(1);
  });

  it("holds steady when current already equals target", () => {
    expect(envelopeStep(0.5, 0.5)).toBe(0.5);
  });
});
