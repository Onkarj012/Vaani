import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { levelFromRms } from "@shared/audioLevel";
import { dictionaryEditError, isOverlayPromptReply, normalizeSnippetTrigger, overlayErrorTitle, snippetEditError } from "@shared/overlayPrompt";
import { PausableTimer } from "@main/pausableTimer";
import { LevelHistory, RIBBON_HEIGHT, accentInk, ribbonBars } from "@renderer/overlay/ribbon";

describe("levelFromRms", () => {
  it("maps -54 dB and below to 0 and -6 dB and above to 1", () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(10 ** (-54 / 20))).toBeCloseTo(0, 6);
    expect(levelFromRms(10 ** (-60 / 20))).toBe(0);
    expect(levelFromRms(10 ** (-6 / 20))).toBeCloseTo(1, 6);
    expect(levelFromRms(1)).toBe(1);
  });

  it("is linear in dB, with no history", () => {
    expect(levelFromRms(10 ** (-30 / 20))).toBeCloseTo(0.5, 6);
    expect(levelFromRms(0.01)).toBe(levelFromRms(0.01));
    expect(levelFromRms(0.01)).toBeLessThan(levelFromRms(0.1));
  });
});

describe("ribbon waveform", () => {
  it("draws 13 bars, taller at the center than the edges, within the 22 px lane", () => {
    const bars = ribbonBars(() => 1, 0);
    expect(bars).toHaveLength(13);
    const heights = bars.map((bar) => bar.height);
    expect(heights[0]).toBeLessThan(heights[6] ?? 0);
    expect(heights[12]).toBeLessThan(heights[6] ?? 0);
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(3);
      expect(height).toBeLessThanOrEqual(RIBBON_HEIGHT);
    }
  });

  it("stays flat at 3 px in silence", () => {
    expect(ribbonBars(() => 0, 1.3).every((bar) => bar.height === 3)).toBe(true);
  });

  it("reaches the center first: outer bars lag the level history", () => {
    const history = new LevelHistory();
    history.step(1, 0.034);
    const bars = ribbonBars((lag) => history.at(lag), 0);
    expect(bars[6]?.height ?? 0).toBeGreaterThan(3);
    expect(bars[0]?.height).toBe(3);
  });

  it("picks dark ink only for light accents", () => {
    expect(accentInk("#7575c8")).toBe("#ffffff");
    expect(accentInk("#e0e0a0")).toBe("#14141a");
    expect(accentInk("not a color")).toBe("#ffffff");
  });
});

describe("prompt edit validation", () => {
  it("requires two different dictionary values", () => {
    expect(dictionaryEditError({ spoken: "git hub", written: "GitHub" })).toBeNull();
    expect(dictionaryEditError({ spoken: " ", written: "GitHub" })).toBe("Both fields need text.");
    expect(dictionaryEditError({ spoken: "Vaani", written: "Vaani" })).toBe("Heard and Write as are the same.");
  });

  it("checks snippet trigger format, conflicts, and phrase", () => {
    expect(normalizeSnippetTrigger(" /reply ")).toBe("reply");
    expect(snippetEditError({ trigger: "/reply", text: "Thanks" })).toBeNull();
    expect(snippetEditError({ trigger: "", text: "Thanks" })).toBe("Add a trigger.");
    expect(snippetEditError({ trigger: "my reply", text: "Thanks" })).toBe("Use letters, numbers, hyphens or underscores.");
    expect(snippetEditError({ trigger: "Sig", text: "Thanks" }, ["sig"])).toBe("/Sig is already a snippet.");
    expect(snippetEditError({ trigger: "reply", text: "  " })).toBe("Add the phrase to insert.");
  });
});

describe("isOverlayPromptReply", () => {
  it("accepts skip and accept replies only in their exact shape", () => {
    expect(isOverlayPromptReply({ id: 3, accepted: false })).toBe(true);
    expect(isOverlayPromptReply({ id: 3, accepted: true, first: "a", second: "b" })).toBe(true);
    expect(isOverlayPromptReply({ id: 3, accepted: true, first: "a" })).toBe(false);
    expect(isOverlayPromptReply({ id: "3", accepted: false })).toBe(false);
    expect(isOverlayPromptReply({ id: 3, accepted: false, first: "a" })).toBe(false);
    expect(isOverlayPromptReply({ id: 3, accepted: true, first: "a".repeat(5_000), second: "b" })).toBe(false);
    expect(isOverlayPromptReply(null)).toBe(false);
  });
});

describe("overlayErrorTitle", () => {
  it("titles errors from the rejection reason", () => {
    expect(overlayErrorTitle("no_speech", null)).toBe("No speech heard");
    expect(overlayErrorTitle("microphone_permission_denied", null)).toBe("Microphone blocked");
    expect(overlayErrorTitle("timeout", null)).toBe("Timed out");
  });

  it("titles insertion problems from the outcome, and leaves unknown causes untitled", () => {
    expect(overlayErrorTitle(null, "unconfirmed")).toBe("Check the field");
    expect(overlayErrorTitle(null, "refused")).toBe("Not inserted");
    expect(overlayErrorTitle(null, "copy-only")).toBeNull();
    expect(overlayErrorTitle(null, null)).toBeNull();
  });
});

describe("PausableTimer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires after its duration", () => {
    const fire = vi.fn();
    new PausableTimer(fire, 8_000);
    vi.advanceTimersByTime(7_999);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledOnce();
  });

  it("keeps the time left across a pause", () => {
    const fire = vi.fn();
    const timer = new PausableTimer(fire, 8_000);
    vi.advanceTimersByTime(3_000);
    timer.pause();
    expect(timer.remainingMs()).toBe(5_000);
    vi.advanceTimersByTime(60_000);
    expect(fire).not.toHaveBeenCalled();
    timer.resume();
    timer.resume();
    vi.advanceTimersByTime(4_999);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledOnce();
  });

  it("never fires once cancelled, even if resumed", () => {
    const fire = vi.fn();
    const timer = new PausableTimer(fire, 1_000);
    timer.cancel();
    timer.resume();
    vi.advanceTimersByTime(5_000);
    expect(fire).not.toHaveBeenCalled();
  });
});
