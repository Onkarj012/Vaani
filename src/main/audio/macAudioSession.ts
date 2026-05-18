import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Optionally switch to built-in mic if a Bluetooth device is active on startup.
 * For wired/USB devices the native PrepareRecordingInput already handles this
 * per-session, so we only need to handle the Bluetooth case here.
 */
export async function configureMacOSAudioSession(): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  try {
    // Check if SwitchAudioSource is available and use it
    const hasSwitchAudio = await hasSwitchAudioSource();
    if (hasSwitchAudio) {
      const currentDevice = await getCurrentAudioInputDevice();

      // If current device is Bluetooth, try to switch to built-in
      if (currentDevice && isBluetoothDeviceName(currentDevice)) {
        const devices = await listAudioInputDevices();
        const builtIn = devices.find(d => isBuiltInDeviceName(d));
        if (builtIn) {
          await setAudioInputDevice(builtIn);
        }
      }
    }
  } catch (error) {
    console.error("[audio-session] Error configuring audio session:", error);
  }
}

/**
 * Get the current audio input device on macOS
 */
export async function getCurrentAudioInputDevice(): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const { stdout } = await execAsync("SwitchAudioSource -c -t input 2>/dev/null || echo 'Unknown'");
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * List all available audio input devices
 */
export async function listAudioInputDevices(): Promise<string[]> {
  if (process.platform !== "darwin") {
    return [];
  }

  try {
    const { stdout } = await execAsync("SwitchAudioSource -a -t input 2>/dev/null || echo ''");
    return stdout.trim().split('\n').filter(d => d.length > 0);
  } catch {
    return [];
  }
}

/**
 * Set audio input device on macOS (requires SwitchAudioSource)
 */
export async function setAudioInputDevice(deviceName: string): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }

  try {
    await execAsync(`SwitchAudioSource -t input -s "${deviceName}" 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if SwitchAudioSource is available
 */
export async function hasSwitchAudioSource(): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }

  try {
    await execAsync("which SwitchAudioSource");
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a device name indicates it's a Bluetooth device
 */
function isBluetoothDeviceName(name: string): boolean {
  const lowerName = name.toLowerCase();
  const bluetoothKeywords = [
    'bluetooth',
    'airpods',
    'airpod',
    'beats',
    'bose',
    'sony',
    'headset',
    'headphones',
    'earbuds',
    'earphone',
    'hands-free',
    'handsfree'
  ];
  return bluetoothKeywords.some(keyword => lowerName.includes(keyword));
}

/**
 * Check if a device name indicates it's a built-in/internal microphone
 */
function isBuiltInDeviceName(name: string): boolean {
  const lowerName = name.toLowerCase();
  const builtInKeywords = [
    'built-in microphone',
    'internal microphone',
    'macbook pro microphone',
    'macbook air microphone',
    'imac microphone',
    'mac mini microphone',
    'mac studio microphone',
    'mac pro microphone',
  ];
  return builtInKeywords.some(keyword => lowerName.includes(keyword));
}
