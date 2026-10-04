import type { AudioInputDevice } from "@shared/types";

export type AudioInputLike = Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">;
type NativeInputLike = Pick<AudioInputDevice, "uid" | "name" | "transportType" | "isPhysical">;

const NO_BUILT_IN_MICROPHONE_MESSAGE = "No built-in microphone found. Choose a microphone in Settings.";
const CHROMIUM_TRANSPORT_LABELS: Readonly<Record<string, string>> = {
  "built-in": "built-in",
  bluetooth: "bluetooth",
  "bluetooth-le": "bluetooth le",
  hdmi: "hdmi",
  "display-port": "displayport",
  airplay: "airplay",
  avb: "avb",
  pci: "pci",
  firewire: "firewire",
  aggregate: "aggregate",
  virtual: "virtual",
};

function isPseudoDevice(deviceId: string): boolean {
  return !deviceId || deviceId === "default" || deviceId === "communications";
}

function matchesNativeInput(label: string, device: NativeInputLike): boolean {
  const browserName = label.trim().toLowerCase();
  const nativeName = device.name.trim().toLowerCase();
  if (!nativeName) return false;
  if (browserName === nativeName) return true;

  // Chromium appends the CoreAudio transport, or USB VID:PID, to the name.
  // Match only that device's suffix; keep parentheses belonging to its name.
  const suffix = CHROMIUM_TRANSPORT_LABELS[device.transportType];
  if (suffix && browserName === `${nativeName} (${suffix})`) return true;
  if (device.transportType === "usb" && browserName.startsWith(`${nativeName} (`)) {
    return /^\([0-9a-f]{4}:[0-9a-f]{4}\)$/.test(browserName.slice(nativeName.length + 1));
  }
  return false;
}

export function selectRecorderDeviceId(devices: AudioInputLike[], nativeDevices: NativeInputLike[]): string | undefined {
  const selected = selectRecorderDevice(devices, undefined, nativeDevices);
  return selected.ok ? selected.deviceId : undefined;
}

export type RecorderDeviceSelection =
  | { ok: true; deviceId: string }
  | { ok: false; message: string };

export function selectRecorderDevice(
  devices: AudioInputLike[],
  preferredDeviceId?: string,
  nativeDevices: NativeInputLike[] = [],
): RecorderDeviceSelection {
  const inputs = devices.filter((device) => device.kind === "audioinput" && !isPseudoDevice(device.deviceId));
  if (preferredDeviceId) {
    const preferred = inputs.find((device) => device.deviceId === preferredDeviceId);
    if (preferred) return { ok: true, deviceId: preferred.deviceId };
  }

  const candidates = preferredDeviceId
    ? nativeDevices.filter((device) => device.uid === preferredDeviceId && device.isPhysical)
    : nativeDevices.filter((device) => device.isPhysical && device.transportType === "built-in");
  const nativeInput = candidates.length === 1 ? candidates[0] : undefined;
  if (!nativeInput) {
    return { ok: false, message: preferredDeviceId ? "Selected microphone is unavailable." : NO_BUILT_IN_MICROPHONE_MESSAGE };
  }
  if (inputs.some((device) => !device.label.trim())) {
    return { ok: false, message: "Microphone names are unavailable. Allow microphone access for Vaani in System Settings, then try again." };
  }

  const matches = inputs.filter((device) => matchesNativeInput(device.label, nativeInput));
  const match = matches.length === 1 ? matches[0] : undefined;
  if (match && nativeDevices.filter((device) => matchesNativeInput(match.label, device)).length === 1) {
    return { ok: true, deviceId: match.deviceId };
  }
  return {
    ok: false,
    message: preferredDeviceId
      ? "Selected microphone could not be matched to a unique browser device."
      : "Built-in microphone could not be matched to a unique browser device.",
  };
}
