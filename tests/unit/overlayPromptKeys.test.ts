import { describe, expect, it, vi } from "vitest";
import { focusMountedPrompt, nextCountdown, nextPromptFocusIndex, overlayPromptKeyAction } from "@renderer/overlay/overlayPrompt";

describe("overlayPromptKeyAction", () => {
  it("skips the prompt on Escape", () => {
    expect(overlayPromptKeyAction("Escape")).toBe("skip");
  });

  it("leaves Enter, Space, and other keys to the focused control", () => {
    expect(overlayPromptKeyAction("Enter")).toBeNull();
    expect(overlayPromptKeyAction(" ")).toBeNull();
    expect(overlayPromptKeyAction("Tab")).toBeNull();
    expect(overlayPromptKeyAction("a")).toBeNull();
  });

  it("backs out of Edit on Escape instead of skipping", () => {
    expect(overlayPromptKeyAction("Escape", { editing: true })).toBe("back");
  });

  it("submits on Enter only from an edit field", () => {
    expect(overlayPromptKeyAction("Enter", { editing: true, inField: true })).toBe("submit");
    expect(overlayPromptKeyAction("Enter", { editing: true, inField: false })).toBeNull();
    expect(overlayPromptKeyAction("Enter", { editing: false, inField: true })).toBeNull();
  });

  it("lets Shift+Enter add a line in the phrase field", () => {
    expect(overlayPromptKeyAction("Enter", { editing: true, inField: true, inTextarea: true, shiftKey: true })).toBeNull();
    expect(overlayPromptKeyAction("Enter", { editing: true, inField: true, inTextarea: true })).toBe("submit");
  });

  it("ignores Enter and Escape while an IME is composing", () => {
    expect(overlayPromptKeyAction("Enter", { editing: true, inField: true, composing: true })).toBeNull();
    expect(overlayPromptKeyAction("Escape", { editing: true, composing: true })).toBeNull();
    expect(overlayPromptKeyAction("Escape", { composing: true })).toBeNull();
  });
});

describe("focusMountedPrompt", () => {
  it("waits until the card mounts", () => {
    const prompt = { focus: vi.fn() };
    expect(focusMountedPrompt(null)).toBe(false);
    expect(prompt.focus).not.toHaveBeenCalled();
    expect(focusMountedPrompt(prompt)).toBe(true);
    expect(prompt.focus).toHaveBeenCalledOnce();
  });
});

describe("nextPromptFocusIndex", () => {
  it("wraps Tab through the prompt buttons", () => {
    expect(nextPromptFocusIndex(-1, 3, false)).toBe(0);
    expect(nextPromptFocusIndex(0, 3, false)).toBe(1);
    expect(nextPromptFocusIndex(2, 3, false)).toBe(0);
  });

  it("wraps Shift+Tab back to the last button", () => {
    expect(nextPromptFocusIndex(0, 3, true)).toBe(2);
    expect(nextPromptFocusIndex(-1, 3, true)).toBe(2);
    expect(nextPromptFocusIndex(2, 3, true)).toBe(1);
  });
});

describe("nextCountdown", () => {
  it("counts down while free and freezes while held", () => {
    expect(nextCountdown(8_000, 100, false)).toBe(7_900);
    expect(nextCountdown(7_900, 100, true)).toBe(7_900);
    expect(nextCountdown(50, 100, false)).toBe(0);
  });
});
