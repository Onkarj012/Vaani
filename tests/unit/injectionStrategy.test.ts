import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { InjectionResult, Settings } from "@shared/types";

const injectorMocks = vi.hoisted(() => ({
  axInject: vi.fn(),
  clipboardInject: vi.fn(),
}));

vi.mock("@main/injection/accessibility", () => ({
  AccessibilityTextInjector: class {
    inject(text: string, target?: unknown): Promise<InjectionResult> {
      return injectorMocks.axInject(text, target);
    }
  },
}));

vi.mock("@main/injection/clipboard", () => ({
  ClipboardTextInjector: class {
    inject(text: string, target?: unknown): Promise<InjectionResult> {
      return injectorMocks.clipboardInject(text, target);
    }
  },
}));

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("TextInjector strategy selection", () => {
  beforeEach(() => {
    injectorMocks.axInject.mockReset();
    injectorMocks.clipboardInject.mockReset();
    injectorMocks.axInject.mockResolvedValue({ success: true, method: "ax" });
    injectorMocks.clipboardInject.mockResolvedValue({ success: true, method: "clipboard" });
  });

  it("uses AX directly when injection mode is ax", async () => {
    const { TextInjector } = await import("@main/injection");
    const injector = new TextInjector(() => settings({ injectionMode: "ax" }));

    await expect(injector.inject("hello")).resolves.toEqual({ success: true, method: "ax" });

    expect(injectorMocks.axInject).toHaveBeenCalledTimes(1);
    expect(injectorMocks.clipboardInject).not.toHaveBeenCalled();
  });

  it("uses clipboard directly when injection mode is clipboard", async () => {
    const { TextInjector } = await import("@main/injection");
    const injector = new TextInjector(() => settings({ injectionMode: "clipboard" }));

    await expect(injector.inject("hello")).resolves.toEqual({ success: true, method: "clipboard" });

    expect(injectorMocks.clipboardInject).toHaveBeenCalledTimes(1);
    expect(injectorMocks.axInject).not.toHaveBeenCalled();
  });

  it("prefers clipboard for browser-like targets in auto mode", async () => {
    const { TextInjector } = await import("@main/injection");
    const injector = new TextInjector(() => settings({ injectionMode: "auto" }));

    await injector.inject("hello", { appBundleId: "com.google.Chrome", appName: "Google Chrome" });

    expect(injectorMocks.clipboardInject).toHaveBeenCalledTimes(1);
    expect(injectorMocks.axInject).not.toHaveBeenCalled();
  });

  it("falls back from AX to clipboard in auto mode for regular targets", async () => {
    injectorMocks.axInject.mockResolvedValueOnce({ success: false, reason: "insertion_failed" });
    const { TextInjector } = await import("@main/injection");
    const injector = new TextInjector(() => settings({ injectionMode: "auto" }));

    await expect(injector.inject("hello", { appBundleId: "com.apple.TextEdit", appName: "TextEdit" }))
      .resolves.toEqual({ success: true, method: "clipboard" });

    expect(injectorMocks.axInject).toHaveBeenCalledTimes(1);
    expect(injectorMocks.clipboardInject).toHaveBeenCalledTimes(1);
  });

  it("keeps clipboard failure for clipboard-only targets without AX fallback", async () => {
    injectorMocks.clipboardInject.mockResolvedValueOnce({ success: false, reason: "insertion_failed" });
    const { TextInjector } = await import("@main/injection");
    const injector = new TextInjector(() => settings({ injectionMode: "auto" }));

    await expect(injector.inject("hello", { appBundleId: "com.apple.Terminal", appName: "Terminal" }))
      .resolves.toEqual({ success: false, reason: "insertion_failed" });

    expect(injectorMocks.clipboardInject).toHaveBeenCalledTimes(1);
    expect(injectorMocks.axInject).not.toHaveBeenCalled();
  });
});
