import type { AudioInputDevice } from "@shared/types";

export type AudioInputLike = Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">;

const VIRTUAL_PATTERNS = [
  "blackhole",
  "loopback",
  "multi-output",
  "virtual",
  "soundflower",
  "display audio",
  "aggregate",
  "obs",
  "zoom audio",
  "teams audio",
  "screen",
];

const BUILT_IN_PATTERNS = ["built-in", "macbook", "internal"];
const BLUETOOTH_PATTERNS = ["bluetooth", "airpods", "wireless"];
const NO_BUILT_IN_MICROPHONE_MESSAGE = "No built-in microphone found. Choose a microphone in Settings.";

function isPseudoDevice(deviceId: string): boolean {
  return !deviceId || deviceId === "default" || deviceId === "communications";
}

function isVirtual(label: string): boolean {
  const lower = label.toLowerCase();
  return VIRTUAL_PATTERNS.some((p) => lower.includes(p));
}

function isBuiltIn(label: string): boolean {
  const lower = label.toLowerCase();
  return BUILT_IN_PATTERNS.some((p) => lower.includes(p))
    && !BLUETOOTH_PATTERNS.some((p) => lower.includes(p));
}

// Automatic renderer capture only opens the built-in mic. Browser device labels
// do not expose transport type, so other inputs cannot be safely classified.
export function selectRecorderDeviceId(devices: AudioInputLike[]): string | undefined {
  const selected = selectRecorderDevice(devices);
  return selected.ok ? selected.deviceId : undefined;
}

export type RecorderDeviceSelection =
  | { ok: true; deviceId: string }
  | { ok: false; message: string };

export function selectRecorderDevice(
  devices: AudioInputLike[],
  preferredDeviceId?: string,
  nativeDevices: Pick<AudioInputDevice, "uid" | "name">[] = [],
): RecorderDeviceSelection {
  const inputs = devices.filter((d) => d.kind === "audioinput" && !isPseudoDevice(d.deviceId));

  if (preferredDeviceId) {
    const preferred = inputs.find((d) => d.deviceId === preferredDeviceId);
    if (preferred) {
      return { ok: true, deviceId: preferred.deviceId };
    }
    const nativeDevice = nativeDevices.find((d) => d.uid === preferredDeviceId);
    if (nativeDevice) {
      const matchingInputs = inputs.filter((d) => d.label.trim().toLowerCase() === nativeDevice.name.trim().toLowerCase());
      const matchingInput = matchingInputs.length === 1 ? matchingInputs[0] : undefined;
      return matchingInput
        ? { ok: true, deviceId: matchingInput.deviceId }
        : { ok: false, message: "Selected microphone could not be matched to a browser device." };
    }
  }

  const builtIn = inputs.find((d) => !isVirtual(d.label) && isBuiltIn(d.label));
  if (builtIn) {
    return { ok: true, deviceId: builtIn.deviceId };
  }

  return { ok: false, message: NO_BUILT_IN_MICROPHONE_MESSAGE };
}
