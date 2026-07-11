import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

const hoisted = vi.hoisted(() => {
  const app = { isPackaged: false };
  const existsSync = vi.fn((_path: string) => false);
  const requireNative = vi.fn();
  const createRequire = vi.fn(() => requireNative);

  return { app, existsSync, requireNative, createRequire };
});

const resourcesPath = "/trusted/resources";

vi.mock("electron", () => ({ app: hoisted.app }));
vi.mock("node:fs", () => ({ existsSync: hoisted.existsSync }));
vi.mock("node:module", () => ({ createRequire: hoisted.createRequire }));

import { nativeBridge, reloadNativeBridge } from "@main/nativeBridge";

describe("nativeBridge loading", () => {
  beforeEach(() => {
    Object.defineProperty(process, "resourcesPath", { configurable: true, value: resourcesPath });
    hoisted.app.isPackaged = false;
    hoisted.existsSync.mockReset();
    hoisted.existsSync.mockReturnValue(false);
    hoisted.requireNative.mockReset();
  });

  it("loads a native module from a trusted packaged resource path", () => {
    const addon = { isAccessibilityTrusted: vi.fn(() => true) };
    const trustedPath = join(resourcesPath, "vaani_native.node");
    hoisted.app.isPackaged = true;
    hoisted.existsSync.mockImplementation((path) => path === trustedPath);
    hoisted.requireNative.mockReturnValue(addon);

    reloadNativeBridge();

    expect(nativeBridge.isAccessibilityTrusted?.()).toBe(true);
    expect(hoisted.requireNative).toHaveBeenCalledWith(trustedPath);
    expect(hoisted.existsSync).toHaveBeenCalledWith(trustedPath);
  });

  it("throws when no native module can be loaded in a packaged build", () => {
    hoisted.app.isPackaged = true;

    expect(() => reloadNativeBridge()).toThrow(
      "Vaani native module not found in packaged resources - refusing to start with a broken/missing native bridge",
    );
    expect(hoisted.requireNative).not.toHaveBeenCalled();
  });

  it("keeps the silent fallback when no native module can be loaded in development", () => {
    reloadNativeBridge();

    expect(nativeBridge.isAccessibilityTrusted).toBeUndefined();
  });
});
