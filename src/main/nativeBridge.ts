import { app } from "electron";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AudioInputDevice, InjectionFailureReason, SelectionRange } from "@shared/types";
import { debug } from "@main/log";

const require = createRequire(import.meta.url);
const currentDir = dirname(fileURLToPath(import.meta.url));

interface NativeInjectionResult {
  success: boolean;
  reason?: InjectionFailureReason | string;
}

export interface NativeLoadFailure {
  kind: "packaged-native-load-failure";
  message: string;
  path: string | null;
}

interface NativeBridge {
  isAccessibilityTrusted?: () => boolean;
  injectText?: (text: string) => NativeInjectionResult;
  pasteText?: (text: string, expectedChangeCount: number) => boolean;
  typeText?: (text: string) => boolean;
  getClipboardChangeCount?: () => number;
  getFocusedSelection?: () => SelectionRange | null;
  getFocusedValue?: () => string | null;
  getFocusedElementIdentity?: () => string | null;
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
  audioCaptureStart?: (options: {
    deviceUid?: string;
    onData: (payload: Float32Array) => void;
    onError: (message: string) => void;
  }) => boolean;
  audioCaptureStop?: () => void;
  audioCaptureListInputDevices?: () => AudioInputDevice[];
  audioCaptureIsRunning?: () => boolean;
  audioCaptureSetRouteChangeHandler?: (callback: (fingerprint?: string) => void) => (() => void) | void;
}

let cachedBridge: NativeBridge | null = null;
let cachedNativeLoadFailure: NativeLoadFailure | null = null;
const nativeLoadFailureListeners = new Set<(failure: NativeLoadFailure) => void>();

function candidatePaths(): string[] {
  // packaged app: extraResource copies to Contents/Resources/
  const packagedRootPath = join(process.resourcesPath ?? "", "vaani_native.node");
  const packagedUnpackedPath = join(process.resourcesPath ?? "", "app.asar.unpacked", ".vite", "build", "vaani_native.node");
  const packagedAppPath = join(process.resourcesPath ?? "", "app", ".vite", "build", "vaani_native.node");

  if (app.isPackaged) {
    return [packagedRootPath, packagedUnpackedPath, packagedAppPath];
  }

  return [
    packagedRootPath,
    join(currentDir, "vaani_native.node"),
    packagedUnpackedPath,
    packagedAppPath,
    join(process.cwd(), "build", "Release", "vaani_native.node"),
    join(currentDir, "../../build/Release/vaani_native.node"),
    join(currentDir, "../../../build/Release/vaani_native.node")
  ];
}

function loadNativeAddon(): NativeBridge {
  if (cachedNativeLoadFailure) return {};
  let failedPath: string | null = null;
  for (const candidatePath of candidatePaths()) {
    if (!existsSync(candidatePath)) {
      continue;
    }

    try {
      const addon = require(candidatePath) as NativeBridge;
      debug("native", `loaded native module from: ${candidatePath}`);
      return addon;
    } catch (error) {
      failedPath = candidatePath;
      debug("native", `failed to load native module from: ${candidatePath} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  debug("native", "no native module found, using fallback bridge");
  if (app.isPackaged) {
    cachedNativeLoadFailure = {
      kind: "packaged-native-load-failure",
      message: "Vaani native module could not be loaded from packaged resources.",
      path: failedPath,
    };
    for (const listener of nativeLoadFailureListeners) listener(cachedNativeLoadFailure);
    debug("native", "cached packaged native-load failure; retries disabled");
    return {};
  }

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

export function getNativeLoadFailure(): NativeLoadFailure | null {
  return cachedNativeLoadFailure;
}

export function subscribeNativeLoadFailure(listener: (failure: NativeLoadFailure) => void): () => void {
  nativeLoadFailureListeners.add(listener);
  if (cachedNativeLoadFailure) listener(cachedNativeLoadFailure);
  return () => nativeLoadFailureListeners.delete(listener);
}

function reloadNativeBridge(): void {
  if (cachedNativeLoadFailure) return;
  cachedBridge = null;
  const bridge = loadNativeAddon();
  if (cachedNativeLoadFailure && app.isPackaged) {
    throw new Error("Vaani native module not found in packaged resources - refusing to start with a broken/missing native bridge");
  }
  cachedBridge = bridge;
  debug("native", "reloaded native module");
}

export const nativeBridge = new Proxy({} as NativeBridge, {
  get(_target, prop: keyof NativeBridge) {
    return getNativeBridge()[prop];
  }
});

export { reloadNativeBridge };
