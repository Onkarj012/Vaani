import { describe, expect, it } from "vitest";
import { nextPromptFocusIndex, overlayPromptKeyAction } from "@renderer/overlay/overlayPrompt";

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
