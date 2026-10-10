import type { RecoveryReadiness } from "@shared/recoveryReadiness";

let recoveryEnabled = false;
let runtimeState: RecoveryReadiness["state"] = "disabled";
export const RECOVERY_ENABLED_BY_DEFAULT = false;

export function isRecoveryEnabled(): boolean { return recoveryEnabled; }
export function isRecoveryReady(): boolean { return recoveryEnabled && runtimeState === "ready"; }
export function getRecoveryReadiness(): RecoveryReadiness {
  return { state: recoveryEnabled ? runtimeState : "disabled", entryCount: null };
}
export function setRecoveryRuntimeState(state: "initializing" | "ready" | "degraded"): void {
  runtimeState = state;
}
export function setRecoveryEnabledForInternalUse(enabled: boolean): void {
  recoveryEnabled = enabled;
  runtimeState = enabled ? "initializing" : "disabled";
}
