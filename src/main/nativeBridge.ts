import { app } from "electron";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { InjectionFailureReason, SelectionRange } from "@shared/types";
import { debug } from "@main/log";

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
  whisperLoadModel?: (modelPath: string) => boolean;
  whisperTranscribe?: (pcmData: Float32Array, sampleRate: number) => string;
  whisperIsModelLoaded?: () => boolean;
  whisperFreeModel?: () => void;
  whisperListModels?: (modelsDir: string) => string[];
}

let cachedBridge: NativeBridge | null = null;

function candidatePaths(): string[] {
  return [
    // packaged app: extraResource copies to Contents/Resources/
    join(process.resourcesPath ?? "", "vaani_native.node"),
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
      const addon = require(candidatePath) as NativeBridge;
      debug("native", `loaded native module from: ${candidatePath}`);
      return addon;
    } catch (error) {
      debug("native", `failed to load native module from: ${candidatePath} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  debug("native", "no native module found, using fallback bridge");
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

function reloadNativeBridge(): void {
  cachedBridge = null;
  const bridge = loadNativeAddon();
  cachedBridge = bridge;
  debug("native", "reloaded native module");
}

export const nativeBridge = new Proxy({} as NativeBridge, {
  get(_target, prop: keyof NativeBridge) {
    return getNativeBridge()[prop];
  }
});

export { reloadNativeBridge };
