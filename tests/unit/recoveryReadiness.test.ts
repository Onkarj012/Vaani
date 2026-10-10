import { afterEach, describe, expect, it } from "vitest";
import { getRecoveryReadiness, isRecoveryReady, setRecoveryEnabledForInternalUse, setRecoveryRuntimeState } from "@main/recoveryReadiness";
import { recoveryReadinessMessage } from "@shared/recoveryReadiness";

afterEach(() => setRecoveryEnabledForInternalUse(false));

describe("authoritative recovery readiness", () => {
  it("distinguishes disabled, initialization, ready, and failed initialization", () => {
    expect(getRecoveryReadiness()).toEqual({ state: "disabled", entryCount: null });
    setRecoveryEnabledForInternalUse(true);
    expect(getRecoveryReadiness().state).toBe("initializing");
    expect(isRecoveryReady()).toBe(false);
    setRecoveryRuntimeState("ready");
    expect(isRecoveryReady()).toBe(true);
    setRecoveryRuntimeState("degraded");
    expect(isRecoveryReady()).toBe(false);
    expect(getRecoveryReadiness().state).toBe("degraded");
  });
  it("does not describe disabled or unavailable recovery as empty", () => {
    expect(recoveryReadinessMessage({ state: "ready", entryCount: 0 })).toContain("No unfinished dictations");
    expect(recoveryReadinessMessage({ state: "disabled", entryCount: null })).toContain("disabled");
    expect(recoveryReadinessMessage({ state: "degraded", entryCount: null })).toContain("unavailable");
    expect(recoveryReadinessMessage({ state: "initializing", entryCount: null })).toContain("not been loaded");
  });
});
