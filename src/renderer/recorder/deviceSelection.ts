import type { AudioInputDevice } from "@shared/types";

export type AudioInputLike = Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">;

const NO_BUILT_IN_MICROPHONE_MESSAGE = "No built-in microphone found. Choose a microphone in Settings.";

function isPseudoDevice(deviceId: string): boolean {
  return !deviceId || deviceId === "default" || deviceId === "communications";
}

// Browser device IDs do not expose CoreAudio transport type. Require a unique
// name match against the native built-in input before opening a default mic.
export function selectRecorderDeviceId(devices: AudioInputLike[], nativeDevices: AudioInputDevice[]): string | undefined {
  const selected = selectRecorderDevice(devices, undefined, nativeDevices);
  return selected.ok ? selected.deviceId : undefined;
}

export type RecorderDeviceSelection =
  | { ok: true; deviceId: string }
  | { ok: false; message: string };

export function selectRecorderDevice(
  devices: AudioInputLike[],
  preferredDeviceId?: string,
  nativeDevices: Pick<AudioInputDevice, "uid" | "name" | "transportType" | "isPhysical">[] = [],
): RecorderDeviceSelection {
  const inputs = devices.filter((d) => d.kind === "audioinput" && !isPseudoDevice(d.deviceId));

  if (preferredDeviceId) {
    const preferred = inputs.find((d) => d.deviceId === preferredDeviceId);
    if (preferred) {
      return { ok: true, deviceId: preferred.deviceId };
    }
    const nativeDevice = nativeDevices.find((d) => d.uid === preferredDeviceId && d.isPhysical);
    if (nativeDevice) {
      const name = nativeDevice.name.trim().toLowerCase();
      const matchingNativeDevices = nativeDevices.filter((device) => device.name.trim().toLowerCase() === name);
      const matchingInputs = inputs.filter((d) => name !== "" && d.label.trim().toLowerCase() === name);
      const matchingInput = matchingInputs.length === 1 ? matchingInputs[0] : undefined;
      return matchingInput && matchingNativeDevices.length === 1
        ? { ok: true, deviceId: matchingInput.deviceId }
        : { ok: false, message: "Selected microphone could not be matched to a browser device." };
    }
    return { ok: false, message: "Selected microphone is unavailable." };
  }

  const builtIns = nativeDevices.filter((device) => device.isPhysical && device.transportType === "built-in");
  if (builtIns.length !== 1) return { ok: false, message: NO_BUILT_IN_MICROPHONE_MESSAGE };
  const builtIn = builtIns[0];
  if (!builtIn) return { ok: false, message: NO_BUILT_IN_MICROPHONE_MESSAGE };
  const name = builtIn.name.trim().toLowerCase();
  const matchingNativeDevices = nativeDevices.filter((device) => device.name.trim().toLowerCase() === name);
  const matches = inputs.filter((device) => name !== "" && device.label.trim().toLowerCase() === name);
  const match = matches.length === 1 ? matches[0] : undefined;
  if (match && matchingNativeDevices.length === 1) return { ok: true, deviceId: match.deviceId };

  return { ok: false, message: "Built-in microphone could not be matched to a unique browser device." };
}
