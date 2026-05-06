import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";

const axInjectMock = vi.fn();
const clipInjectMock = vi.fn();

vi.mock("@main/injection/accessibility", () => ({
  AccessibilityTextInjector: class {
    inject = axInjectMock;
  }
}), { virtual: true });

vi.mock("@main/injection/clipboard", () => ({
  ClipboardTextInjector: class {
    inject = clipInjectMock;
  }
}), { virtual: true });

vi.mock("@main/nativeBridge", () => ({
  nativeBridge: {}
}), { virtual: true });

describe("TextInjector", () => {
  beforeEach(() => {
    axInjectMock.mockReset();
    clipInjectMock.mockReset();
  });

  it.skip("does not fall back to AX for clipboard-only editor targets", async () => {
    const { TextInjector } = await import("@main/injection");
    clipInjectMock.mockResolvedValue({ success: false, reason: "insertion_failed" });
    axInjectMock.mockResolvedValue({ success: true, method: "ax" });

    const injector = new TextInjector(() => ({ ...DEFAULT_SETTINGS, injectionMode: "auto" }));
    const result = await injector.inject("hello world", {
      appBundleId: "net.whatsapp.WhatsApp",
      appName: "WhatsApp",
      selection: null
    });

    expect(result).toEqual({ success: false, reason: "insertion_failed" });
    expect(clipInjectMock).toHaveBeenCalledTimes(1);
    expect(axInjectMock).not.toHaveBeenCalled();
  });

  it.skip("still falls back to AX for native editors when clipboard is only preferred by text shape", async () => {
    const { TextInjector } = await import("@main/injection");
    clipInjectMock.mockResolvedValue({ success: false, reason: "insertion_failed" });
    axInjectMock.mockResolvedValue({ success: true, method: "ax" });

    const injector = new TextInjector(() => ({ ...DEFAULT_SETTINGS, injectionMode: "auto" }));
    const result = await injector.inject("hello\nworld", {
      appBundleId: "com.apple.TextEdit",
      appName: "TextEdit",
      selection: null
    });

    expect(result).toEqual({ success: true, method: "ax" });
    expect(clipInjectMock).toHaveBeenCalledTimes(1);
    expect(axInjectMock).toHaveBeenCalledTimes(1);
  });
});
