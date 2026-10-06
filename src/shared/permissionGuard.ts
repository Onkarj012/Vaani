import type { MacOSPermissionState, PermissionStatus } from "./types";

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
