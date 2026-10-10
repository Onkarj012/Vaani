import { beforeEach, describe, expect, it, vi } from "vitest";
import { isExternalTarget } from "@main/injection/target";

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
    bridge.injectText.mockReturnValue({ success: false, reason: "outcome_uncertain" });

    await expect(new AccessibilityTextInjector().inject("dictated"))
      .resolves.toEqual({ success: false, reason: "outcome_uncertain" });
    expect(bridge.injectText).toHaveBeenCalledTimes(1);
  });

  it("reports a pre-write native failure as fallback-eligible without marking dispatch", async () => {
    const { AccessibilityTextInjector } = await import("@main/injection/accessibility");
    const onDispatch = vi.fn();
    bridge.injectText.mockReturnValue({ success: false, reason: "no_editable_target" });

    await expect(new AccessibilityTextInjector().inject("dictated", undefined, undefined, onDispatch))
      .resolves.toEqual({ success: false, reason: "no_editable_target" });
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("marks dispatch when a native write may have happened", async () => {
    const { AccessibilityTextInjector } = await import("@main/injection/accessibility");
    const onDispatch = vi.fn();
    bridge.injectText.mockReturnValue({ success: true });

    await expect(new AccessibilityTextInjector().inject("dictated", undefined, undefined, onDispatch))
      .resolves.toEqual({ success: true, method: "ax" });
    expect(onDispatch).toHaveBeenCalledTimes(1);
  });

  it("accepts an explicit AX insertion at an empty field's {0,0} caret", async () => {
    const { AccessibilityTextInjector } = await import("@main/injection/accessibility");
    bridge.injectText.mockReturnValue({ success: true });
    vi.mocked(isExternalTarget).mockReturnValueOnce(true);

    await expect(new AccessibilityTextInjector().inject("dictated", {
      appBundleId: "com.apple.TextEdit",
      appName: "TextEdit",
      selection: { location: 0, length: 0 },
    })).resolves.toEqual({ success: true, method: "ax" });
    expect(bridge.injectText).toHaveBeenCalledWith("dictated");
  });

  it("treats a native exception after invocation as uncertain", async () => {
    const { AccessibilityTextInjector } = await import("@main/injection/accessibility");
    bridge.injectText.mockImplementation(() => { throw new Error("failed after partial write"); });

    await expect(new AccessibilityTextInjector().inject("dictated"))
      .resolves.toEqual({ success: false, reason: "outcome_uncertain" });
    expect(bridge.injectText).toHaveBeenCalledTimes(1);
  });
});
