import { app } from "electron";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { InjectionFailureReason, SelectionRange } from "@shared/types";

const require = createRequire(import.meta.url);
const currentDir = dirname(fileURLToPath(import.meta.url));

interface NativeInjectionResult {
  success: boolean;
  reason?: InjectionFailureReason | string;
}

interface NativeBridge {
  isAccessibilityTrusted?: () => boolean;
  injectText?: (text: string) => NativeInjectionResult;
  pasteText?: (text: string) => boolean;
  typeText?: (text: string) => boolean;
  getFocusedSelection?: () => SelectionRange | null;
  getFocusedValue?: () => string | null;
  setFocusedSelection?: (location: number, length: number) => boolean;
  getFrontmostApplication?: () => { bundleId?: string; name?: string };
  startHotkeyMonitor?: (accelerator: string, callback: (isPressed: boolean) => void) => boolean;
  stopHotkeyMonitor?: () => void;
  startPasteLatestMonitor?: (accelerator: string, callback: () => void) => boolean;
  stopPasteLatestMonitor?: () => void;
  prepareRecordingInput?: () => number | null;
  restoreRecordingInput?: (deviceId: number) => boolean;
}

let cachedBridge: NativeBridge | null = null;

function candidatePaths(): string[] {
  return [
    join(currentDir, "vaani_native.node"),
    join(process.resourcesPath ?? "", "app.asar.unpacked", ".vite", "build", "vaani_native.node"),
    join(process.resourcesPath ?? "", "app", ".vite", "build", "vaani_native.node"),
    join(process.cwd(), "build", "Release", "vaani_native.node"),
    join(currentDir, "../../build/Release/vaani_native.node"),
    join(currentDir, "../../../build/Release/vaani_native.node")
  ];
}

function loadNativeAddon(): NativeBridge {
  for (const candidatePath of candidatePaths()) {
    if (!existsSync(candidatePath)) {
      continue;
    }

    try {
      console.log("[vaani] loaded native module from:", candidatePath);
      return require(candidatePath) as NativeBridge;
    } catch (error) {
      console.warn("[vaani] failed to load native module from:", candidatePath, error);
    }
  }

  console.warn("[vaani] no native module found, using fallback bridge");
  return {};
}

function getNativeBridge(): NativeBridge {
  if (cachedBridge) {
    return cachedBridge;
  }

  if (!app.isReady()) {
    return {};
  }

  cachedBridge = loadNativeAddon();
  return cachedBridge;
}

export const nativeBridge = new Proxy({} as NativeBridge, {
  get(_target, prop: keyof NativeBridge) {
    return getNativeBridge()[prop];
  }
});
