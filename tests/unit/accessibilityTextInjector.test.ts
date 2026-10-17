import { beforeEach, describe, expect, it, vi } from "vitest";
import { isExternalTarget } from "@main/injection/target";

const bridge = vi.hoisted(() => ({
  isAccessibilityTrusted: vi.fn(() => true),
  injectText: vi.fn(),
  getFocusedValue: vi.fn<() => string | null>(() => ""),
  getFocusedSelection: vi.fn<() => { location: number; length: number } | null>(() => ({ location: 0, length: 0 })),
  setFocusedSelection: vi.fn((_location: number, _length: number) => true),
}));

vi.mock("@main/nativeBridge", () => ({ nativeBridge: bridge }));
vi.mock("@main/injection/target", () => ({
  activateTargetApp: vi.fn(async () => false),
  isExternalTarget: vi.fn(() => false),
}));

describe("AccessibilityTextInjector dispatch safety", () => {
  beforeEach(() => {
    bridge.injectText.mockReset();
    bridge.getFocusedValue.mockReset().mockReturnValue("");
    bridge.getFocusedSelection.mockReset().mockReturnValue({ location: 0, length: 0 });
    bridge.setFocusedSelection.mockClear();
  });

  it("moves the caret to the end of inserted text when the field shows it there", async () => {
    const { AccessibilityTextInjector } = await import("@main/injection/accessibility");
    bridge.injectText.mockReturnValue({ success: true });
    bridge.getFocusedValue.mockReturnValue("dictated");

    await expect(new AccessibilityTextInjector().inject("dictated")).resolves.toEqual({ success: true, method: "ax" });
    expect(bridge.setFocusedSelection).toHaveBeenCalledWith(8, 0);
  });

  it("leaves the caret alone when the field text does not match the insertion", async () => {
    const { AccessibilityTextInjector } = await import("@main/injection/accessibility");
    bridge.injectText.mockReturnValue({ success: true });
    bridge.getFocusedValue.mockReturnValue("someone else wrote this");

    await expect(new AccessibilityTextInjector().inject("dictated")).resolves.toEqual({ success: true, method: "ax" });
    expect(bridge.setFocusedSelection).not.toHaveBeenCalled();
  });

  it("leaves the caret alone when the app already moved it past the insertion start", async () => {
    const { AccessibilityTextInjector } = await import("@main/injection/accessibility");
    bridge.injectText.mockReturnValue({ success: true });
    bridge.getFocusedValue.mockReturnValue("dictated");
    bridge.getFocusedSelection.mockReturnValueOnce({ location: 0, length: 0 }).mockReturnValue({ location: 8, length: 0 });

    await expect(new AccessibilityTextInjector().inject("dictated")).resolves.toEqual({ success: true, method: "ax" });
    expect(bridge.setFocusedSelection).not.toHaveBeenCalled();
  });

  it("leaves the caret alone when the insertion start is unknown", async () => {
    const { AccessibilityTextInjector } = await import("@main/injection/accessibility");
    bridge.injectText.mockReturnValue({ success: true });
    bridge.getFocusedValue.mockReturnValue("dictated");
    bridge.getFocusedSelection.mockReturnValue(null);

    await expect(new AccessibilityTextInjector().inject("dictated")).resolves.toEqual({ success: true, method: "ax" });
    expect(bridge.setFocusedSelection).not.toHaveBeenCalled();
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
