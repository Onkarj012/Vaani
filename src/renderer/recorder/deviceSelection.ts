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
// system audio. Returns undefined when no acceptable physical mic exists so the
// caller can fall back to the browser/system default.
export function selectRecorderDeviceId(devices: AudioInputLike[]): string | undefined {
  const inputs = devices.filter((d) => d.kind === "audioinput" && !isPseudoDevice(d.deviceId));
  const physical = inputs.filter((d) => !isVirtual(d.label));
  const builtIn = physical.find((d) => isBuiltIn(d.label));
  const chosen = builtIn ?? physical[0];
  return chosen?.deviceId || undefined;
}
