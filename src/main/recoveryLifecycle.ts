import type { PermissionStatus } from "@shared/types";
import type { RecoveryErrorClass, RecoveryLifecycleEvent, RecoveryRouteHandoff } from "@shared/recovery";
import type { NativeLoadFailure } from "./nativeBridge";
import type { CaptureResumeResult, CaptureSuspendResult } from "./audio/nativeCapture";
import type { RecoveryJournalStore } from "./store/recoveryJournal";

export type LifecycleEventKind = "suspend" | "resume" | "route-change" | "permission-change" | "capture-interruption" | "native-load-failure";

export interface LifecycleCaptureController {
  suspendForLifecycle: () => CaptureSuspendResult | Promise<CaptureSuspendResult>;
  resumeAfterLifecycle: () => CaptureResumeResult;
}

export interface LifecycleDictationController {
  getActiveSession: () => { sessionId: string; generation: number } | null;
  handleLifecycleSuspended: (
    sessionId: string,
    generation: number,
    partialClip?: CaptureSuspendResult["partialClip"],
  ) => Promise<boolean>;
  handleLifecycleInterruption: (
    sessionId: string,
    generation: number,
    message: string,
    errorClass: RecoveryErrorClass,
    partialClip?: CaptureSuspendResult["partialClip"],
    routeHandoff?: RecoveryRouteHandoff,
  ) => Promise<boolean>;
  handleLifecycleRouteHandoff?: (sessionId: string, generation: number, handoff: RecoveryRouteHandoff) => Promise<boolean>;
}

export interface LifecycleCoordinatorDependencies {
  journal: Pick<RecoveryJournalStore, "flush"> & Partial<Pick<RecoveryJournalStore, "markLifecycle">>;
  capture: LifecycleCaptureController;
  dictation: LifecycleDictationController;
  getPermissionStatus: () => PermissionStatus;
  suspendTimeoutMs?: number;
  recoveryReady?: () => boolean;
  reportStatus?: (message: string) => void;
}

interface PowerMonitorLike {
  on(event: "suspend", listener: () => void): void;
  on(event: "resume", listener: () => void): void;
}

interface RouteSubscription {
  subscribe: (listener: (fingerprint?: string) => void) => (() => void) | void;
}

export class RecoveryLifecycleCoordinator {
  private operation: Promise<void> = Promise.resolve();
  private generationValue = 0;
  private suspended = false;
  private permissionDenied = false;
  private lastRouteFingerprint: string | null = null;
  private nativeFailure: NativeLoadFailure | null = null;
  private routeUnsubscribe: (() => void) | null = null;

  constructor(private readonly deps: LifecycleCoordinatorDependencies) {
    this.permissionDenied = deps.getPermissionStatus().microphone !== "granted";
  }

  get generation(): number {
    return this.generationValue;
  }

  get nativeLoadFailure(): NativeLoadFailure | null {
    return this.nativeFailure;
  }

  attach(powerMonitor: PowerMonitorLike, routeSubscription?: RouteSubscription): void {
    powerMonitor.on("suspend", () => { void this.handleSuspend(); });
    powerMonitor.on("resume", () => { void this.handleResume(); });
    if (routeSubscription) {
      this.routeUnsubscribe = routeSubscription.subscribe((fingerprint) => { void this.handleRouteChange(fingerprint); }) ?? null;
    }
  }

  dispose(): void {
    this.routeUnsubscribe?.();
    this.routeUnsubscribe = null;
  }

  async flush(): Promise<void> {
    await this.operation;
    await this.deps.journal.flush();
  }

  handleSuspend(): Promise<void> {
    return this.enqueue("suspend", async () => {
      if (this.suspended) return;
      this.suspended = true;
      this.generationValue += 1;
      this.deps.reportStatus?.("Preparing audio recovery…");
      await this.deps.journal.flush();
      const active = this.deps.dictation.getActiveSession();
      const handoff = await this.suspendCapture();
      if (active && (handoff.sessionId === active.sessionId || handoff.sessionId === null)) {
        await this.recordLifecycle(active.sessionId, "sleep");
        if (handoff.recordingResumed === true && handoff.sessionId === active.sessionId) {
          await this.deps.dictation.handleLifecycleSuspended(active.sessionId, active.generation, handoff.partialClip);
        } else {
          await this.interruptActive(active, handoff, "Dictation was interrupted by sleep. The recording is recoverable.", "interrupted");
        }
      }
      await this.deps.journal.flush();
      this.deps.reportStatus?.("Audio paused until wake.");
    });
  }

  handleResume(): Promise<void> {
    return this.enqueue("resume", async () => {
      if (!this.suspended) return;
      this.generationValue += 1;
      this.deps.reportStatus?.("Restoring microphone…");
      this.permissionDenied = this.deps.getPermissionStatus().microphone !== "granted";
      if (this.permissionDenied) {
        this.deps.reportStatus?.("Microphone permission is required to resume dictation.");
        return;
      }
      await this.resumeCapture("wake");
    });
  }

  handleRouteChange(fingerprint?: string): Promise<void> {
    return this.enqueue("route-change", async () => {
      const routeKey = fingerprint ?? "route-change";
      if (routeKey === this.lastRouteFingerprint) return;
      this.lastRouteFingerprint = routeKey;
      if (this.suspended || this.permissionDenied) return;
      this.generationValue += 1;
      this.deps.reportStatus?.("Audio route changed; restoring microphone…");
      const active = this.deps.dictation.getActiveSession();
      const handoff = await this.suspendCapture();
      const result = this.deps.capture.resumeAfterLifecycle();
      const routeHandoff: RecoveryRouteHandoff = {
        generation: this.generationValue,
        fromDeviceUid: null,
        toDeviceUid: result.selectedDeviceUid,
        occurredAt: new Date().toISOString(),
      };
      if (active && result.ok) {
        await this.recordLifecycle(active.sessionId, "route-change");
        if (handoff.recordingResumed !== false) {
          await this.deps.dictation.handleLifecycleSuspended(active.sessionId, active.generation, handoff.partialClip);
        } else {
          await this.interruptActive(active, handoff, "Dictation was interrupted by an audio route change.", "audio_route_changed", routeHandoff);
        }
        if (handoff.recordingResumed !== false) {
          await this.deps.dictation.handleLifecycleRouteHandoff?.(active.sessionId, active.generation, routeHandoff);
        }
      } else if (active) {
        await this.interruptActive(active, handoff, "Dictation was interrupted by an audio route change.", "audio_route_changed", routeHandoff);
      }
      await this.deps.journal.flush();
      if (!result.ok) {
        this.deps.reportStatus?.(result.message ?? "No valid physical microphone is available.");
        return;
      }
      this.deps.reportStatus?.("Microphone route restored.");
    });
  }

  handlePermissionChanged(status: PermissionStatus = this.deps.getPermissionStatus()): Promise<void> {
    return this.enqueue("permission-change", async () => {
      const denied = status.microphone !== "granted";
      if (denied === this.permissionDenied) return;
      this.permissionDenied = denied;
      this.generationValue += 1;
      if (denied) {
        this.deps.reportStatus?.("Microphone permission was revoked.");
        await this.deps.journal.flush();
        const active = this.deps.dictation.getActiveSession();
        const handoff = await this.suspendCapture();
        if (active) await this.recordLifecycle(active.sessionId, "permission-revoked");
        if (active && handoff.recordingResumed === true) {
          await this.deps.dictation.handleLifecycleSuspended(active.sessionId, active.generation, handoff.partialClip);
        } else {
          await this.interruptActive(active, handoff, "Microphone permission was revoked. Enable it in System Settings, then start a new dictation.", "microphone_permission_denied");
        }
        await this.deps.journal.flush();
        return;
      }
      this.deps.reportStatus?.("Microphone permission restored.");
      if (this.suspended) {
        await this.resumeCapture("permission-restored");
        return;
      }
      const result = this.deps.capture.resumeAfterLifecycle();
      if (!result.ok) this.deps.reportStatus?.(result.message ?? "Microphone could not be restored.");
    });
  }

  handleCaptureInterruption(
    sessionId: string,
    partialClip?: CaptureSuspendResult["partialClip"],
    message = "Audio capture was interrupted.",
  ): Promise<void> {
    return this.enqueue("capture-interruption", async () => {
      const active = this.deps.dictation.getActiveSession();
      if (!active || active.sessionId !== sessionId) return;
      this.generationValue += 1;
      await this.recordLifecycle(sessionId, "capture-interrupted");
      await this.interruptActive(active, { wasRunning: true, sessionId, ...(partialClip ? { partialClip } : {}) }, message, "interrupted");
      await this.deps.journal.flush();
      this.deps.reportStatus?.("Audio capture stopped; the recording is recoverable.");
    });
  }

  handleNativeLoadFailure(failure: NativeLoadFailure): Promise<void> {
    return this.enqueue("native-load-failure", async () => {
      if (this.nativeFailure) return;
      this.nativeFailure = failure;
      this.generationValue += 1;
      const active = this.deps.dictation.getActiveSession();
      if (active) await this.recordLifecycle(active.sessionId, "native-load-failure");
      this.deps.reportStatus?.("Native microphone support could not load. Renderer capture remains available; restart Vaani after repairing the installation.");
      await this.deps.journal.flush();
    });
  }

  private async interruptActive(
    active: { sessionId: string; generation: number } | null,
    handoff: CaptureSuspendResult,
    message: string,
    errorClass: RecoveryErrorClass,
    routeHandoff?: RecoveryRouteHandoff,
  ): Promise<void> {
    const sessionId = active?.sessionId ?? handoff.sessionId;
    if (!active || !sessionId) return;
    await this.deps.dictation.handleLifecycleInterruption(
      sessionId,
      active.generation,
      message,
      errorClass,
      handoff.partialClip,
      routeHandoff,
    );
  }

  private async suspendCapture(): Promise<CaptureSuspendResult> {
    try {
      return await withTimeout(this.deps.capture.suspendForLifecycle(), this.deps.suspendTimeoutMs ?? 2_000);
    } catch {
      const active = this.deps.dictation.getActiveSession();
      return { wasRunning: !!active, sessionId: active?.sessionId ?? null, recordingResumed: false };
    }
  }

  private async resumeCapture(event: "wake" | "permission-restored"): Promise<void> {
    const result = this.deps.capture.resumeAfterLifecycle();
    if (!result.ok) {
      const active = this.deps.dictation.getActiveSession();
      if (active) await this.interruptActive(active, { wasRunning: true, sessionId: active.sessionId }, result.message ?? "Microphone could not be restored.", "device_unavailable");
      this.deps.reportStatus?.(result.message ?? "Microphone could not be restored. Check the selected input device.");
      return;
    }
    this.suspended = false;
    const active = this.deps.dictation.getActiveSession();
    if (active) {
      await this.recordLifecycle(active.sessionId, event);
      await this.deps.dictation.handleLifecycleRouteHandoff?.(active.sessionId, active.generation, {
        generation: this.generationValue,
        fromDeviceUid: null,
        toDeviceUid: result.selectedDeviceUid,
        occurredAt: new Date().toISOString(),
      });
    }
    this.deps.reportStatus?.("Microphone ready.");
  }

  private async recordLifecycle(sessionId: string, event: RecoveryLifecycleEvent): Promise<void> {
    if (this.deps.recoveryReady && !this.deps.recoveryReady()) return;
    await this.deps.journal.markLifecycle?.(sessionId, sessionId, {
      event,
      generation: this.generationValue,
      occurredAt: new Date().toISOString(),
    });
  }

  private enqueue(kind: LifecycleEventKind, operation: () => Promise<void>): Promise<void> {
    const run = this.operation.catch(() => undefined).then(operation);
    this.operation = run.catch((error: unknown) => {
      this.deps.reportStatus?.(`${kind} recovery failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return run;
  }
}

function withTimeout<T>(value: T | Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Lifecycle capture suspension timed out.")), timeoutMs);
    Promise.resolve(value).then((result) => { clearTimeout(timer); resolve(result); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
