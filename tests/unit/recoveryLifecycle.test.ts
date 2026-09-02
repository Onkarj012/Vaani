import { describe, expect, it, vi } from "vitest";
import type { PermissionStatus } from "@shared/types";
import { createRecoveryEntry } from "@shared/recovery";
import { RecoveryLifecycleCoordinator } from "@main/recoveryLifecycle";
import type { CaptureSuspendResult } from "@main/audio/nativeCapture";

const granted: PermissionStatus = { microphone: "granted", accessibility: "granted" };
const denied: PermissionStatus = { microphone: "denied", accessibility: "granted" };

function createHarness() {
  let active: { sessionId: string; generation: number } | null = { sessionId: "session-1", generation: 1 };
  let permission = granted;
  let captureSuspended = false;
  const journal = {
    flush: vi.fn(async () => undefined),
    markLifecycle: vi.fn(async () => createRecoveryEntry({ id: "lifecycle", sessionId: "lifecycle", buildIdentifier: "test" })),
  };
  const suspendForLifecycle = vi.fn<() => CaptureSuspendResult | Promise<CaptureSuspendResult>>(() => {
      captureSuspended = true;
      return { wasRunning: true, sessionId: active?.sessionId ?? null };
  });
  const capture = {
    suspendForLifecycle,
    resumeAfterLifecycle: vi.fn(() => {
      captureSuspended = false;
      return { ok: true as const, selectedDeviceUid: "built-in" };
    }),
  };
  const dictation = {
    getActiveSession: vi.fn(() => active),
    handleLifecycleSuspended: vi.fn(async () => true),
    handleLifecycleInterruption: vi.fn(async () => {
      active = null;
      return true;
    }),
    handleLifecycleRouteHandoff: vi.fn(async () => true),
  };
  const coordinator = new RecoveryLifecycleCoordinator({
    journal,
    capture,
    dictation,
    getPermissionStatus: () => permission,
  });
  return {
    coordinator,
    journal,
    capture,
    dictation,
    setPermission: (next: PermissionStatus) => { permission = next; },
    setActive: (next: { sessionId: string; generation: number } | null) => { active = next; },
    isCaptureSuspended: () => captureSuspended,
  };
}

describe("RecoveryLifecycleCoordinator", () => {
  it("does not complete suspension until capture acknowledges finalized cleanup", async () => {
    const harness = createHarness();
    let acknowledge: ((result: { wasRunning: boolean; sessionId: string; recordingResumed: true }) => void) | null = null;
    harness.capture.suspendForLifecycle.mockImplementationOnce(() => new Promise<CaptureSuspendResult>((resolve) => {
      acknowledge = resolve;
    }));

    const suspension = harness.coordinator.handleSuspend();
    await vi.waitFor(() => expect(acknowledge).not.toBeNull());
    expect(harness.dictation.handleLifecycleSuspended).not.toHaveBeenCalled();
    acknowledge!({ wasRunning: true, sessionId: "session-1", recordingResumed: true });
    await suspension;
    expect(harness.dictation.handleLifecycleSuspended).toHaveBeenCalledWith("session-1", 1, undefined);
  });

  it("fails closed when capture suspension rejects or times out", async () => {
    const harness = createHarness();
    harness.coordinator = new RecoveryLifecycleCoordinator({
      journal: harness.journal,
      capture: { ...harness.capture, suspendForLifecycle: vi.fn(() => new Promise<CaptureSuspendResult>(() => undefined)) },
      dictation: harness.dictation,
      getPermissionStatus: () => granted,
      suspendTimeoutMs: 1,
    });
    await harness.coordinator.handleSuspend();
    expect(harness.dictation.handleLifecycleInterruption).toHaveBeenCalledWith(
      "session-1", 1, expect.stringContaining("sleep"), "interrupted", undefined, undefined,
    );
  });

  it("serializes and idempotently completes 500 duplicate sleep/wake cycles", async () => {
    const harness = createHarness();
    for (let cycle = 0; cycle < 500; cycle += 1) {
      await Promise.all([harness.coordinator.handleSuspend(), harness.coordinator.handleSuspend()]);
      expect(harness.isCaptureSuspended()).toBe(true);
      await Promise.all([harness.coordinator.handleResume(), harness.coordinator.handleResume()]);
      expect(harness.isCaptureSuspended()).toBe(false);
    }
    expect(harness.capture.suspendForLifecycle).toHaveBeenCalledTimes(500);
    expect(harness.capture.resumeAfterLifecycle).toHaveBeenCalledTimes(500);
    expect(harness.journal.flush).toHaveBeenCalled();
  });

  it("handles dock, unplug, and Bluetooth route fingerprints once each", async () => {
    const harness = createHarness();
    await harness.coordinator.handleRouteChange("dock");
    await harness.coordinator.handleRouteChange("dock");
    await harness.coordinator.handleRouteChange("unplug");
    await harness.coordinator.handleRouteChange("bluetooth");
    expect(harness.capture.suspendForLifecycle).toHaveBeenCalledTimes(3);
    expect(harness.capture.resumeAfterLifecycle).toHaveBeenCalledTimes(3);
    expect(harness.dictation.handleLifecycleRouteHandoff).toHaveBeenCalledTimes(3);
  });

  it("persists permission revoke as remediation and allows a clean regrant", async () => {
    const harness = createHarness();
    harness.setPermission(denied);
    await harness.coordinator.handlePermissionChanged();
    expect(harness.dictation.handleLifecycleInterruption).toHaveBeenCalledWith(
      "session-1",
      1,
      expect.stringContaining("permission was revoked"),
      "microphone_permission_denied",
      undefined,
      undefined,
    );
    harness.setPermission(granted);
    harness.setActive({ sessionId: "session-2", generation: 2 });
    await harness.coordinator.handlePermissionChanged();
    expect(harness.coordinator.generation).toBeGreaterThan(0);
  });

  it("resumes once after wake waits for denied microphone permission", async () => {
    const harness = createHarness();
    await harness.coordinator.handleSuspend();
    harness.setPermission(denied);
    await harness.coordinator.handlePermissionChanged();
    await harness.coordinator.handleResume();
    expect(harness.isCaptureSuspended()).toBe(true);
    expect(harness.capture.resumeAfterLifecycle).toHaveBeenCalledTimes(0);

    harness.setPermission(granted);
    await harness.coordinator.handlePermissionChanged();
    expect(harness.capture.resumeAfterLifecycle).toHaveBeenCalledTimes(1);
    expect(harness.isCaptureSuspended()).toBe(false);
    await harness.coordinator.handleResume();
    expect(harness.capture.resumeAfterLifecycle).toHaveBeenCalledTimes(1);
  });

  it("rejects interruption for a stale generation and contains native failure once", async () => {
    const harness = createHarness();
    harness.setActive({ sessionId: "new-session", generation: 2 });
    await harness.coordinator.handleCaptureInterruption("old-session");
    expect(harness.dictation.handleLifecycleInterruption).not.toHaveBeenCalled();

    const failure = { kind: "packaged-native-load-failure" as const, message: "missing", path: null };
    await Promise.all([
      harness.coordinator.handleNativeLoadFailure(failure),
      harness.coordinator.handleNativeLoadFailure(failure),
    ]);
    expect(harness.coordinator.nativeLoadFailure).toEqual(failure);
  });
});
