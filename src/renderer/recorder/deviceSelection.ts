import type { AudioInputDevice, MacOSPermissionState } from "@shared/types";

export type AudioInputLike = Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">;
type NativeInputLike = Pick<AudioInputDevice, "uid" | "name" | "transportType" | "isPhysical"> & Partial<Pick<AudioInputDevice, "isDefault">>;

const NO_PHYSICAL_MICROPHONE_MESSAGE = "No physical microphone found. Choose a microphone in Settings.";
const MICROPHONE_PERMISSION_MESSAGE = "Microphone names are unavailable. Allow microphone access for Vaani in System Settings, then try again.";
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

/** Bluetooth mics switch earphones into call mode and duck output, so only an explicit choice may open them. */
function isBluetoothTransport(transportType: string): boolean {
  return transportType === "bluetooth" || transportType === "bluetooth-le";
}

/** Exclude browser aliases whose physical source can change with system defaults. */
function isPseudoDevice(deviceId: string): boolean {
  return !deviceId || deviceId === "default" || deviceId === "communications";
}

/** Match CoreAudio names with only the Chromium suffix expected for that transport. */
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

/** Return the selected browser ID, or undefined when physical identity is ambiguous. */
export function selectRecorderDeviceId(devices: AudioInputLike[], nativeDevices: NativeInputLike[]): string | undefined {
  const selected = selectRecorderDevice(devices, undefined, nativeDevices);
  return selected.ok ? selected.deviceId : undefined;
}

export type RecorderDeviceSelection =
  | { ok: true; deviceId: string }
  | { ok: false; message: string };

/** Explain a rejected identity match without silently choosing another microphone. */
function selectionFailure(preferredDeviceId?: string): RecorderDeviceSelection {
  return {
    ok: false,
    message: preferredDeviceId
      ? "Selected microphone could not be matched to a unique physical browser device."
      : "Microphone could not be matched to a unique physical browser device.",
  };
}

/** Classify recognized physical browser labels when native metadata is unavailable; reject virtual device names. */
function browserInputKind(label: string): "built-in" | "external" | undefined {
  const name = label.trim().toLowerCase();
  if (/blackhole|loopback|multi-output|virtual|soundflower|aggregate|obs|zoom audio|teams audio|background music/.test(name)) return undefined;
  if (/\(built-in\)$/.test(name) || /^(macbook (pro|air)|imac|internal|built-in) microphone$/.test(name)) return "built-in";
  if (/\((bluetooth( le)?|[0-9a-f]{4}:[0-9a-f]{4})\)$/.test(name)) return "external";
  return undefined;
}

/** Select a unique transport-marked browser input without depending on the native addon. */
function selectWithoutNativeMetadata(inputs: AudioInputLike[], preferredDeviceId?: string): RecorderDeviceSelection {
  const physical = inputs.filter((device) => browserInputKind(device.label));
  const chosen = preferredDeviceId
    ? physical.find((device) => device.deviceId === preferredDeviceId)
    : physical.find((device) => browserInputKind(device.label) === "built-in")
      ?? physical.find((device) => !/\(bluetooth( le)?\)$/.test(device.label.trim().toLowerCase()));
  if (!chosen) return preferredDeviceId ? selectionFailure(preferredDeviceId) : { ok: false, message: NO_PHYSICAL_MICROPHONE_MESSAGE };
  const name = chosen.label.trim().toLowerCase();
  return inputs.filter((device) => device.label.trim().toLowerCase() === name).length === 1
    ? { ok: true, deviceId: chosen.deviceId }
    : selectionFailure(preferredDeviceId);
}

/** Resolve a browser input using native identity, or conservative browser labels when the addon is unavailable. */
export function selectRecorderDevice(
  devices: AudioInputLike[],
  preferredDeviceId?: string,
  nativeDevices: NativeInputLike[] = [],
): RecorderDeviceSelection {
  const inputs = devices.filter((device) => device.kind === "audioinput" && !isPseudoDevice(device.deviceId));
  if (inputs.some((device) => !device.label.trim())) return { ok: false, message: MICROPHONE_PERMISSION_MESSAGE };
  if (nativeDevices.length === 0) return selectWithoutNativeMetadata(inputs, preferredDeviceId);

  if (preferredDeviceId) {
    const preferred = inputs.find((device) => device.deviceId === preferredDeviceId);
    if (preferred) {
      const nativeMatches = nativeDevices.filter((device) => matchesNativeInput(preferred.label, device));
      const nativeMatch = nativeMatches.length === 1 ? nativeMatches[0] : undefined;
      const browserMatches = inputs.filter((device) => device.label.trim().toLowerCase() === preferred.label.trim().toLowerCase());
      return nativeMatch?.isPhysical && browserMatches.length === 1
        ? { ok: true, deviceId: preferred.deviceId }
        : selectionFailure(preferredDeviceId);
    }
  }

  const physical = nativeDevices.filter((device) => device.isPhysical);
  if (preferredDeviceId) {
    const candidates = physical.filter((device) => device.uid === preferredDeviceId);
    const nativeInput = candidates.length === 1 ? candidates[0] : undefined;
    if (!nativeInput) return { ok: false, message: "Selected microphone is unavailable." };
    return uniqueBrowserMatch(inputs, nativeDevices, nativeInput, preferredDeviceId);
  }

  const automatic = physical.filter((device) => !isBluetoothTransport(device.transportType));
  if (automatic.length === 0) return { ok: false, message: NO_PHYSICAL_MICROPHONE_MESSAGE };
  const rank = (device: NativeInputLike): number => (device.transportType === "built-in" ? 0 : device.isDefault ? 1 : 2);
  for (const nativeInput of automatic.sort((a, b) => rank(a) - rank(b))) {
    // Chromium can omit or duplicate a CoreAudio input; try the next physical one instead of failing.
    const selected = uniqueBrowserMatch(inputs, nativeDevices, nativeInput);
    if (selected.ok) return selected;
  }
  return selectionFailure();
}

/** Return the browser input for a native device only when both identities match uniquely. */
function uniqueBrowserMatch(
  inputs: AudioInputLike[],
  nativeDevices: NativeInputLike[],
  nativeInput: NativeInputLike,
  preferredDeviceId?: string,
): RecorderDeviceSelection {
  const matches = inputs.filter((device) => matchesNativeInput(device.label, nativeInput));
  const match = matches.length === 1 ? matches[0] : undefined;
  if (match && nativeDevices.filter((device) => matchesNativeInput(match.label, device)).length === 1) {
    return { ok: true, deviceId: match.deviceId };
  }
  return selectionFailure(preferredDeviceId);
}

export interface RecorderDeviceAccess {
  enumerateDevices: () => Promise<AudioInputLike[]>;
  listAudioInputDevices: () => Promise<NativeInputLike[]>;
  requestMicrophonePermission: () => Promise<MacOSPermissionState>;
}

/** Request first-use OS access without opening the system-default microphone, then select an exact input ID. */
export async function chooseRecorderDeviceId(access: RecorderDeviceAccess, preferredDeviceId?: string): Promise<string> {
  let devices = await access.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput" && !isPseudoDevice(device.deviceId));
  if (inputs.length === 0 || inputs.some((device) => !device.label.trim())) {
    const permission = await access.requestMicrophonePermission();
    if (permission === "denied" || permission === "restricted") throw new Error(MICROPHONE_PERMISSION_MESSAGE);
    // Development Electron can report not-determined for its main process
    // while the Chromium capture process can expose and request the exact mic.
    devices = await access.enumerateDevices();
  }
  const nativeDevices = await access.listAudioInputDevices().catch(() => []);
  const selected = selectRecorderDevice(devices, preferredDeviceId, nativeDevices);
  if (!selected.ok) throw new Error(selected.message);
  return selected.deviceId;
}
