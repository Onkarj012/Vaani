import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Keyboard, Loader2, Mic, RefreshCw, ShieldCheck } from "lucide-react";
import type { MacOSPermissionState, PermissionStatus } from "@shared/types";
import {
  getAccessibilityPermissionRemediation,
  getMicrophonePermissionRemediation,
  getPermissionStatusLabel,
  isPermissionReady,
} from "@shared/permissionGuard";
import { Button } from "@renderer/components/ui/button";
import { Card } from "@renderer/components/ui/card";

interface PermissionGuardProps {
  onBlockingChange: (blocked: boolean) => void;
}

const INITIAL_STATUS: PermissionStatus = { microphone: "unknown", accessibility: "unknown" };
const MICROPHONE_ATTEMPT_GUIDANCE = "macOS did not grant microphone access. Enable Vaani in System Settings, then click Check Again.";

export default function PermissionGuard({ onBlockingChange }: PermissionGuardProps) {
  const [status, setStatus] = useState<PermissionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [microphoneAttempted, setMicrophoneAttempted] = useState(false);
  const [microphoneGuidance, setMicrophoneGuidance] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const requestInFlightRef = useRef(false);
  const statusVersionRef = useRef(0);

  const blocked = status === null || error !== null || !isPermissionReady(status ?? INITIAL_STATUS);
  const microphone = status?.microphone ?? "unknown";
  const accessibility = status?.accessibility ?? "unknown";
  const microphoneRemediation = getMicrophonePermissionRemediation(microphone, microphoneAttempted);
  const accessibilityRemediation = getAccessibilityPermissionRemediation(accessibility);
  const hasRequiredAction = microphoneRemediation.action !== "none" || accessibilityRemediation.action !== "none";
  const checking = status === null && error === null;
  const focusKey = [
    microphone,
    accessibility,
    microphoneRemediation.action,
    accessibilityRemediation.action,
    hasRequiredAction,
    error,
  ].join(":");

  useEffect(() => {
    window.vaani.reportRendererReady();
  }, []);

  const refresh = useCallback(async () => {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    const version = ++statusVersionRef.current;
    try {
      const nextStatus = await window.vaani.getPermissionStatus();
      if (version !== statusVersionRef.current) return;
      setStatus(nextStatus);
      setError(null);
    } catch (cause) {
      if (version !== statusVersionRef.current) return;
      setError(cause instanceof Error ? cause.message : "Could not check macOS permissions.");
    } finally {
      requestInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!blocked) return;
    const interval = window.setInterval(() => { void refresh(); }, 1_800);
    return () => window.clearInterval(interval);
  }, [blocked, refresh]);

  useEffect(() => {
    const unsubscribe = window.vaani.onPermissionStatusChanged?.((nextStatus) => {
      statusVersionRef.current += 1;
      setStatus(nextStatus);
      setError(null);
    });
    return () => { unsubscribe?.(); };
  }, []);

  useEffect(() => {
    if (microphone === "granted") {
      setMicrophoneAttempted(false);
      setMicrophoneGuidance(null);
    }
  }, [microphone]);

  useEffect(() => {
    onBlockingChange(blocked);
  }, [blocked, onBlockingChange]);

  useEffect(() => {
    if (!blocked) return;
    const focusTimer = window.setTimeout(() => {
      firstActionRef.current?.focus();
      if (!firstActionRef.current) modalRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [blocked, focusKey]);

  const runAction = useCallback(async (action: () => Promise<void>, refreshAfter = true) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Vaani could not complete that permission action.");
    } finally {
      setBusy(false);
      if (refreshAfter) void refresh();
    }
  }, [busy, refresh]);

  const requestMicrophone = useCallback(() => {
    if (!status || status.microphone !== "not-determined") return;
    void runAction(async () => {
      const microphone = await window.vaani.requestMicrophonePermission();
      setMicrophoneAttempted(true);
      setStatus((current) => current ? { ...current, microphone } : current);
      if (microphone === "granted") {
        setMicrophoneGuidance(null);
        await refresh();
        return;
      }
      setMicrophoneGuidance(MICROPHONE_ATTEMPT_GUIDANCE);
      await window.vaani.openPermissionSettings("microphone");
    }, false);
  }, [refresh, runAction, status]);

  const microphoneSettings = useCallback(() => {
    void runAction(() => window.vaani.openPermissionSettings("microphone"));
  }, [runAction]);

  const requestAccessibility = useCallback(() => {
    void runAction(async () => {
      const accessibility = await window.vaani.requestAccessibilityPermission();
      if (accessibility !== "granted") await window.vaani.openPermissionSettings("accessibility");
    });
  }, [runAction]);

  const accessibilitySettings = useCallback(() => {
    void runAction(() => window.vaani.openPermissionSettings("accessibility"));
  }, [runAction]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      return;
    }
    if (event.key !== "Tab" || !modalRef.current) return;
    const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    ));
    if (focusable.length === 0) {
      event.preventDefault();
      modalRef.current.focus();
      return;
    }
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
    event.preventDefault();
    focusable[nextIndex]?.focus();
  }, []);

  if (!blocked) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overscroll-none bg-black/55 p-4 backdrop-blur-md">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-guard-title"
        aria-describedby="permission-guard-description"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex max-h-[min(92vh,760px)] w-full max-w-[620px] flex-col overflow-hidden rounded-[20px] bg-bg shadow-card outline-none"
      >
        <div className="shrink-0 border-b border-line px-6 pb-5 pt-7 sm:px-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            {checking ? <Loader2 size={24} className="animate-spin-ui" /> : <ShieldCheck size={24} />}
          </div>
          <h1 id="permission-guard-title" className="text-display text-3xl text-ink">Permissions required</h1>
          <p id="permission-guard-description" className="mt-2 text-sm leading-relaxed text-muted">
            Vaani checks Microphone and Accessibility each time it starts.
          </p>
          <p role="status" aria-live="polite" className="mt-3 text-xs text-faint">
            {checking ? "Checking macOS permissions…" : error ? "Permission check failed. Vaani stays blocked until it can verify access." : "Dictation is blocked until both permissions are granted."}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-8">
          <div className="space-y-3">
            <PermissionRow
              icon={<Mic size={19} />}
              title="Microphone"
              description="Records only while dictation is active."
              state={microphone}
              action={microphoneRemediation.action}
              guidance={microphoneGuidance ?? microphoneRemediation.guidance}
              primaryRef={microphoneRemediation.action === "request" ? firstActionRef : undefined}
              busy={busy}
              onRequest={requestMicrophone}
              onSettings={microphoneSettings}
              onRetry={() => { void refresh(); }}
            />
            <PermissionRow
              icon={<Keyboard size={19} />}
              title="Accessibility"
              description="Enables the global shortcut and cursor insertion."
              state={accessibility}
              action={accessibilityRemediation.action}
              guidance={accessibilityRemediation.guidance}
              primaryRef={microphoneRemediation.action !== "request" && accessibilityRemediation.action !== "none" ? firstActionRef : undefined}
              busy={busy}
              onRequest={requestAccessibility}
              onSettings={accessibilitySettings}
              onRetry={() => { void refresh(); }}
            />
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-accent/20 bg-accent/5 px-4 py-3 text-left text-xs leading-relaxed text-accent">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-5 sm:px-8">
          <p className="text-xs text-faint">System Settings may need to remain open while you enable access.</p>
          <Button ref={!hasRequiredAction ? firstActionRef : undefined} variant="soft" size="sm" onClick={() => { void refresh(); }} disabled={busy}>
            <RefreshCw size={15} /> Check Again
          </Button>
        </div>
      </div>
    </div>
  );
}

function PermissionRow({
  icon, title, description, state, action, guidance, primaryRef, busy, onRequest, onSettings, onRetry,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  state: MacOSPermissionState;
  action: "none" | "request" | "open-settings" | "retry";
  guidance?: string;
  primaryRef?: Ref<HTMLButtonElement>;
  busy: boolean;
  onRequest: () => void;
  onSettings: () => void;
  onRetry: () => void;
}) {
  const granted = state === "granted";
  return (
    <Card tone={granted ? "mint" : "surface"} className="p-4" bordered>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${granted ? "bg-accent/10 text-accent" : "bg-bg text-muted"}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-ink">{title}</div>
            <div className={`flex items-center gap-1.5 text-xs font-medium ${granted ? "text-accent" : "text-muted"}`}>
              {granted ? <CheckCircle2 size={14} /> : null}{getPermissionStatusLabel(state)}
            </div>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
          {guidance && <p className="mt-2 text-xs leading-relaxed text-accent">{guidance}</p>}
          {!granted && action !== "none" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {action === "request" && <Button ref={primaryRef} variant="accent" size="sm" onClick={onRequest} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin-ui" /> : null}{title === "Microphone" ? "Allow Microphone" : "Enable Accessibility"}</Button>}
              {action === "open-settings" && <Button ref={primaryRef} variant="soft" size="sm" onClick={onSettings} disabled={busy}><ExternalLink size={14} /> Open Settings</Button>}
              {action === "retry" && <Button ref={primaryRef} variant="soft" size="sm" onClick={onRetry} disabled={busy}><RefreshCw size={14} /> Retry</Button>}
              {(action === "retry" || (title === "Accessibility" && action === "request")) && <Button variant="ghost" size="sm" onClick={onSettings} disabled={busy}><ExternalLink size={14} /> Settings</Button>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
