let recoveryEnabled = false;

export const RECOVERY_ENABLED_BY_DEFAULT = false;

export function isRecoveryEnabled(): boolean {
  return recoveryEnabled;
}

export function setRecoveryEnabledForInternalUse(enabled: boolean): void {
  recoveryEnabled = enabled;
}
