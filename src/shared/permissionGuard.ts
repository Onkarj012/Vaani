import type { MacOSPermissionState, PermissionStatus } from "./types";

export type PermissionGuardAction = "none" | "request" | "open-settings" | "retry";

export interface PermissionRemediation {
  action: PermissionGuardAction;
  guidance?: string;
}

export interface PermissionStatusIndicator {
  allGranted: boolean;
  label: string;
  description: string;
}

export function isPermissionReady(status: PermissionStatus): boolean {
  return status.microphone === "granted" && status.accessibility === "granted";
}

export function getPermissionStatusLabel(state: MacOSPermissionState): string {
  switch (state) {
    case "granted": return "Granted";
    case "not-determined": return "Needs approval";
    case "denied": return "Not granted";
    case "restricted": return "Restricted";
    case "unknown": return "Could not verify";
  }
}

export function getPermissionStatusIndicator(status: PermissionStatus): PermissionStatusIndicator {
  if (isPermissionReady(status)) {
    return {
      allGranted: true,
      label: "Ready",
      description: "Microphone and Accessibility are enabled for dictation.",
    };
  }

  const missing = [
    status.microphone !== "granted" ? "Microphone" : null,
    status.accessibility !== "granted" ? "Accessibility" : null,
  ].filter((permission): permission is string => permission !== null);
  return {
    allGranted: false,
    label: "Action needed",
    description: `${missing.join(" and ")} ${missing.length === 1 ? "needs" : "need"} access before dictation can run.`,
  };
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
