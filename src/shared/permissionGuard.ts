import type { MacOSPermissionState, PermissionStatus } from "./types";

export type PermissionGuardAction = "none" | "request" | "open-settings" | "retry";

export interface PermissionRemediation {
  action: PermissionGuardAction;
  guidance?: string;
}

export function isPermissionReady(status: PermissionStatus): boolean {
  return status.microphone === "granted" && status.accessibility === "granted";
}

export function getMicrophonePermissionRemediation(state: MacOSPermissionState, attempted = false): PermissionRemediation {
  switch (state) {
    case "not-determined":
      return attempted
        ? { action: "open-settings", guidance: "macOS did not grant microphone access. Enable Vaani in System Settings, then click Check Again." }
        : { action: "request" };
    case "denied": return { action: "open-settings" };
    case "restricted": return {
      action: "open-settings",
      guidance: "Microphone access is restricted by macOS or a device policy. Check Privacy & Security or contact your administrator.",
    };
    case "unknown": return { action: "retry", guidance: "Vaani could not read the microphone permission. Try again or open Microphone settings." };
    case "granted": return { action: "none" };
  }
}

export function getAccessibilityPermissionRemediation(state: MacOSPermissionState): PermissionRemediation {
  switch (state) {
    case "not-determined":
    case "denied": return { action: "request" };
    case "restricted": return { action: "open-settings", guidance: "Accessibility access is restricted by macOS or a device policy." };
    case "unknown": return { action: "retry", guidance: "Vaani could not read Accessibility access. Try again or open Accessibility settings." };
    case "granted": return { action: "none" };
  }
}
