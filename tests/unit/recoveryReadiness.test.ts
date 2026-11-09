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
    expect(recoveryReadinessMessage({ state: "ready", entryCount: 0 })).toBe("No unfinished dictations. Finished ones stay in History.");
    expect(recoveryReadinessMessage({ state: "ready", entryCount: 2 })).toBe("Unfinished dictations can be retried from here.");
    expect(recoveryReadinessMessage({ state: "disabled", entryCount: null })).toBe("This build doesn't keep an unfinished dictation for retry. Finished ones stay in History.");
    expect(recoveryReadinessMessage({ state: "degraded", entryCount: null })).toBe("Unfinished dictations can't be opened right now. Restart Vaani and try again. Finished ones are still in History.");
    expect(recoveryReadinessMessage({ state: "initializing", entryCount: null })).toBe("Loading unfinished dictations. They'll show up here in a moment.");
    expect(recoveryReadinessMessage({ state: "disabled", entryCount: null })).not.toContain("No unfinished");
    expect(recoveryReadinessMessage({ state: "degraded", entryCount: null })).not.toContain("No unfinished");
  });
});
