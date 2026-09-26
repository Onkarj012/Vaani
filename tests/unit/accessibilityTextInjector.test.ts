import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  isAccessibilityTrusted: vi.fn(() => true),
  injectText: vi.fn(),
  getFocusedValue: vi.fn(() => ""),
}));

vi.mock("@main/nativeBridge", () => ({ nativeBridge: bridge }));
vi.mock("@main/injection/target", () => ({
  activateTargetApp: vi.fn(async () => false),
  isExternalTarget: vi.fn(() => false),
}));

describe("AccessibilityTextInjector dispatch safety", () => {
  beforeEach(() => {
    bridge.injectText.mockReset();
  });

  it("treats a native failure after invocation as uncertain", async () => {
    const { AccessibilityTextInjector } = await import("@main/injection/accessibility");
    bridge.injectText.mockReturnValue({ success: false, reason: "no_editable_target" });

    await expect(new AccessibilityTextInjector().inject("dictated"))
      .resolves.toEqual({ success: false, reason: "outcome_uncertain" });
    expect(bridge.injectText).toHaveBeenCalledTimes(1);
  });

  it("treats a native exception after invocation as uncertain", async () => {
    const { AccessibilityTextInjector } = await import("@main/injection/accessibility");
    bridge.injectText.mockImplementation(() => { throw new Error("failed after partial write"); });

    await expect(new AccessibilityTextInjector().inject("dictated"))
      .resolves.toEqual({ success: false, reason: "outcome_uncertain" });
    expect(bridge.injectText).toHaveBeenCalledTimes(1);
  });
});
