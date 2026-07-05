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
const NO_PHYSICAL_MICROPHONE_MESSAGE = "No physical microphone found. Choose a real microphone in Settings, or disconnect virtual/loopback audio devices.";

function isPseudoDevice(deviceId: string): boolean {
  return !deviceId || deviceId === "default" || deviceId === "communications";
}

function isVirtual(label: string): boolean {
  const lower = label.toLowerCase();
  return VIRTUAL_PATTERNS.some((p) => lower.includes(p));
}

function isBuiltIn(label: string): boolean {
  const lower = label.toLowerCase();
  return BUILT_IN_PATTERNS.some((p) => lower.includes(p));
}

// Pick a physical microphone, skipping virtual/loopback inputs that can capture
// system audio.
export function selectRecorderDeviceId(devices: AudioInputLike[]): string | undefined {
  const selected = selectRecorderDevice(devices);
  return selected.ok ? selected.deviceId : undefined;
}

export type RecorderDeviceSelection =
  | { ok: true; deviceId: string }
  | { ok: false; message: string };

export function selectRecorderDevice(devices: AudioInputLike[], preferredDeviceId?: string): RecorderDeviceSelection {
  const inputs = devices.filter((d) => d.kind === "audioinput" && !isPseudoDevice(d.deviceId));

  if (preferredDeviceId) {
    const preferred = inputs.find((d) => d.deviceId === preferredDeviceId);
    if (preferred) {
      return { ok: true, deviceId: preferred.deviceId };
    }
  }

  const physical = inputs.filter((d) => !isVirtual(d.label));
  const builtIn = physical.find((d) => isBuiltIn(d.label));
  const chosen = builtIn ?? physical[0];
  if (chosen?.deviceId) {
    return { ok: true, deviceId: chosen.deviceId };
  }

  return { ok: false, message: NO_PHYSICAL_MICROPHONE_MESSAGE };
}
