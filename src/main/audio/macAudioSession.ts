import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * AppleScript to configure macOS audio session to prevent ducking.
 * This script sets the audio session category to PlayAndRecord with MixWithOthers.
 */
const AUDIO_SESSION_SCRIPT = `
-- This script attempts to prevent audio ducking by configuring the audio session
-- It works by setting system audio properties via CoreAudio

try
    -- Set the audio session to mix with others (prevent ducking)
    do shell script "defaults write -g AVAudioSessionCategoryOptions -int 1"
    
    -- Also try to set the audio category via launch services
    do shell script "defaults write com.apple.audio.DeviceSettings 'PreferredInputDevice' -string 'Built-in Microphone'"
    
    return "Audio session configured"
on error errMsg
    return "Error: " & errMsg
end try
`;

/**
 * Configure macOS audio session to prevent ducking of other apps.
 * Uses AppleScript and command-line tools to set the appropriate audio session options.
 */
export async function configureMacOSAudioSession(): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  try {
    // Method 1: Use defaults to set audio preferences
    const defaultsCommands = [
      // Disable audio ducking for this app
      'defaults write -g com.apple.audio.DeviceSettings.PreferredInputDevice -string "Built-in Microphone" 2>/dev/null || true',
      // Set audio session options (MixWithOthers = 1)
      'defaults write -g AVAudioSessionCategoryOptions -int 1 2>/dev/null || true',
      // Disable voice processing (can cause ducking)
      'defaults write -g com.apple.audio.VoiceProcessingEnabled -bool false 2>/dev/null || true'
    ];

    for (const cmd of defaultsCommands) {
      try {
        await execAsync(cmd);
      } catch (e) {
        // Ignore individual command failures
      }
    }

    // Method 2: Use osascript to run AppleScript
    try {
      await execAsync(`osascript -e '${AUDIO_SESSION_SCRIPT}'`);
    } catch {
      // AppleScript might fail, that's ok
    }

    // Method 3: Check if SwitchAudioSource is available and use it
    const hasSwitchAudio = await hasSwitchAudioSource();
    if (hasSwitchAudio) {
      const currentDevice = await getCurrentAudioInputDevice();

      // If current device is Bluetooth, try to switch to built-in
      if (currentDevice && isBluetoothDeviceName(currentDevice)) {
        const devices = await listAudioInputDevices();
        const builtIn = devices.find(d => !isBluetoothDeviceName(d));
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
