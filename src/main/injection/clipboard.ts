import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { clipboard } from "electron";
import type { InjectionResult } from "@shared/types";
import { nativeBridge } from "../nativeBridge";
import type { InjectionTarget } from "./index";
import { isClipboardOnlyTarget, shouldPreferTypingInjection } from "./policy";
import { activateTargetApp, isTargetFrontmost } from "./target";
import type { InjectionBlockReason, InjectionGuard } from "./guard";

const exec = promisify(execFile);
let consecutiveFailures = 0;
const CLIPBOARD_RESTORE_DELAY_MS = 1_200;
let restoreGeneration = 0;
let pendingRestore: { original: string; changeCount: number } | null = null;
let injectionQueue: Promise<void> | null = null;
const UTF8_CLIPBOARD_ENV = {
  ...process.env,
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  LC_CTYPE: "UTF-8"
};

type DispatchOutcome = "dispatched" | "failed" | "outcome_uncertain" | InjectionBlockReason;

export function cancelPendingClipboardRestore(): void {
  restoreGeneration += 1;
  pendingRestore = null;
}

export class ClipboardTextInjector {
  async inject(text: string, target?: InjectionTarget, guard: InjectionGuard = () => null, onDispatch?: () => void): Promise<InjectionResult> {
    const previous = injectionQueue;
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    injectionQueue = current;
    if (previous) await previous;
    try {
      return await this.injectSerialized(text, target, guard, onDispatch);
    } finally {
      release();
      if (injectionQueue === current) injectionQueue = null;
    }
  }

  private async injectSerialized(text: string, target?: InjectionTarget, guard: InjectionGuard = () => null, onDispatch?: () => void): Promise<InjectionResult> {
    const blockedAtStart = guard();
    if (blockedAtStart) return { success: false, reason: blockedAtStart };
    if (clipboardChangeCount() === null) return { success: false, reason: "insertion_failed" };
    const original = await readOriginalClipboardText();
    const generation = ++restoreGeneration;
    let ownedChangeCount: number | null = null;
    const dispatchGuard: InjectionGuard = () => guard() ?? (ownedChangeCount !== null && clipboardChangeCount() !== ownedChangeCount ? "cancelled" : null);
    try {
      ownedChangeCount = await writeClipboardText(text);
      if (ownedChangeCount === null) return { success: false, reason: "insertion_failed" };
      await delay(180);

      // Clipboard-only apps (terminals, browsers, Electron apps, etc.) have no AX
      // selection tracking. Running the full fallback chain would fire multiple
      // paste methods causing text to appear multiple times. For these apps:
      // one shot, then return immediately.
      // Dispatch once for targets whose AX value cannot confirm the paste.
      if (isClipboardOnlyTarget(target)) {
        const blockedBeforeActivation = dispatchGuard();
        if (blockedBeforeActivation) return { success: false, reason: blockedBeforeActivation };
        const outcome = await this.pasteWithNativeBridge(text, target, dispatchGuard, () => ownedChangeCount, onDispatch);
        if (outcome === "dispatched") {
          if (dispatchGuard()) return { success: false, reason: "outcome_uncertain" };
          consecutiveFailures = 0;
          return { success: true, method: "clipboard" };
        }
        if (outcome !== "failed") return { success: false, reason: outcome };
        consecutiveFailures += 1;
        return { success: false, reason: "insertion_failed" };
      }

      const hasNonAscii = /[^\x00-\x7F]/.test(text);

      const methods = hasNonAscii
        ? [
            { name: "paste-native", run: () => this.pasteWithNativeBridge(text, target, dispatchGuard, () => ownedChangeCount, onDispatch), kind: "paste" as const }
          ]
        : shouldPreferTypingInjection(target)
        ? [
            { name: "type-native", run: () => this.typeWithNativeBridge(text, target, dispatchGuard, onDispatch), kind: "typing" as const },
            { name: "type-applescript", run: () => this.typeWithAppleScript(text, target, dispatchGuard, onDispatch), kind: "typing" as const },
            { name: "paste-native", run: () => this.pasteWithNativeBridge(text, target, dispatchGuard, () => ownedChangeCount, onDispatch), kind: "paste" as const }
          ]
        : prefersSystemEventsPaste(target)
        ? [
            { name: "paste-native", run: () => this.pasteWithNativeBridge(text, target, dispatchGuard, () => ownedChangeCount, onDispatch), kind: "paste" as const },
            { name: "type-native", run: () => this.typeWithNativeBridge(text, target, dispatchGuard, onDispatch), kind: "typing" as const },
            { name: "type-applescript", run: () => this.typeWithAppleScript(text, target, dispatchGuard, onDispatch), kind: "typing" as const },
          ]
        : [
            { name: "paste-native", run: () => this.pasteWithNativeBridge(text, target, dispatchGuard, () => ownedChangeCount, onDispatch), kind: "paste" as const },
            { name: "type-native", run: () => this.typeWithNativeBridge(text, target, dispatchGuard, onDispatch), kind: "typing" as const },
            { name: "type-applescript", run: () => this.typeWithAppleScript(text, target, dispatchGuard, onDispatch), kind: "typing" as const }
          ];

      // Only methods that never dispatched may fall through to the next one.
      // Once keystrokes or a paste reach the target, an unconfirmed result is
      // uncertain and retrying would risk inserting the text twice.
      let pasted = false;
      for (const method of methods) {
        const outcome = await method.run();
        if (outcome === "failed") continue;
        if (outcome !== "dispatched") return { success: false, reason: outcome };
        if (dispatchGuard()) return { success: false, reason: "outcome_uncertain" };
        if (!await confirmInsertion(text, target, method.kind, dispatchGuard)) {
          consecutiveFailures += 1;
          return { success: false, reason: "outcome_uncertain" };
        }
        await maybeRestoreCaretAfterInsertion(text, target, method.kind);
        pasted = true;
        break;
      }

      await delay(600);
      if (pasted) {
        if (dispatchGuard()) return { success: false, reason: "outcome_uncertain" };
        consecutiveFailures = 0;
        return { success: true, method: "clipboard" };
      }
      consecutiveFailures += 1;
      return { success: false, reason: "insertion_failed" };
    } finally {
      if (original !== text && ownedChangeCount !== null) {
        pendingRestore = { original, changeCount: ownedChangeCount };
        void restoreClipboardAfterDelay(original, ownedChangeCount, CLIPBOARD_RESTORE_DELAY_MS, generation);
      } else if (generation === restoreGeneration) {
        pendingRestore = null;
      }
    }
  }

  private async pasteWithNativeBridge(text: string, target: InjectionTarget | undefined, guard: InjectionGuard, expectedChangeCount: () => number | null, onDispatch?: () => void): Promise<DispatchOutcome> {
    if (!nativeBridge.pasteText) return "failed";
    let dispatched = false;
    try {
      const blocked = await prepareDispatch(target, guard, true);
      if (blocked) return blocked;
      const changeCount = expectedChangeCount();
      if (changeCount === null) return "failed";
      onDispatch?.();
      dispatched = true;
      return nativeBridge.pasteText(text, changeCount, target?.appBundleId ?? undefined, target?.pid ?? undefined) ? "dispatched" : "outcome_uncertain";
    } catch {
      return dispatched ? "outcome_uncertain" : "failed";
    }
  }

  private async typeWithNativeBridge(text: string, target: InjectionTarget | undefined, guard: InjectionGuard, onDispatch?: () => void): Promise<DispatchOutcome> {
    if (!nativeBridge.typeText) return "failed";
    let dispatched = false;
    try {
      const blocked = await prepareDispatch(target, guard, true);
      if (blocked) return blocked;
      onDispatch?.();
      dispatched = true;
      return nativeBridge.typeText(text) ? "dispatched" : "outcome_uncertain";
    } catch {
      return dispatched ? "outcome_uncertain" : "failed";
    }
  }

  private async typeWithAppleScript(text: string, target: InjectionTarget | undefined, guard: InjectionGuard, onDispatch?: () => void): Promise<DispatchOutcome> {
    return runAppleScriptDispatch([`tell application "System Events" to keystroke ${toAppleScriptString(text)}`], target, guard, onDispatch);
  }
}

async function prepareDispatch(target: InjectionTarget | undefined, guard: InjectionGuard, release: boolean): Promise<InjectionBlockReason | null> {
  const blockedBeforeActivation = guard();
  if (blockedBeforeActivation) return blockedBeforeActivation;
  await ensureTargetReady(target);
  if (release) {
    await releaseModifiers();
    await delay(60);
  }
  return guard();
}

async function runAppleScriptDispatch(action: string[], target: InjectionTarget | undefined, guard: InjectionGuard, onDispatch?: () => void): Promise<DispatchOutcome> {
  try {
    const blockedBeforeActivation = guard();
    if (blockedBeforeActivation) return blockedBeforeActivation;
    const lines = [...modifierReleaseLines(), "delay 0.05", ...action];
    if (await ensureTargetReady(target)) {
      lines.unshift("delay 0.05");
    }
    const blocked = guard();
    if (blocked) return blocked;
    // osascript may fail after System Events has already sent some keys.
    // Treat its result as uncertain once the command starts, so no fallback
    // strategy can insert the same text a second time.
    try {
      onDispatch?.();
      await exec("osascript", lines.flatMap(l => ["-e", l]));
      return "dispatched";
    } catch {
      return "outcome_uncertain";
    }
  } catch { return "failed"; }
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function modifierReleaseLines(): string[] {
  return [
    'tell application "System Events" to key up command',
    'tell application "System Events" to key up option',
    'tell application "System Events" to key up control',
    'tell application "System Events" to key up shift'
  ];
}

function prefersSystemEventsPaste(target?: InjectionTarget): boolean {
  const haystack = `${target?.appBundleId ?? ""} ${target?.appName ?? ""}`.toLowerCase();
  return haystack.includes("whatsapp") || haystack.includes("messages") || haystack.includes("telegram") || haystack.includes("signal");
}

async function releaseModifiers(): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await exec("osascript", modifierReleaseLines().flatMap(line => ["-e", line]));
      await delay(60);
    } catch {
      // best-effort only
    }
  }
}

async function readClipboardText(): Promise<string> {
  try {
    const result = await exec("pbpaste", [], { env: UTF8_CLIPBOARD_ENV, encoding: "utf8" });
    return result.stdout;
  } catch {
    return clipboard.readText();
  }
}

// While an earlier restore is still pending the clipboard holds that
// injection's text, not the user's. Chain back to the user's clipboard so the
// eventual restore returns what the user actually had.
async function readOriginalClipboardText(): Promise<string> {
  const current = await readClipboardText();
  if (pendingRestore && clipboardChangeCount() === pendingRestore.changeCount) return pendingRestore.original;
  return current;
}

function clipboardChangeCount(): number | null {
  try {
    return nativeBridge.getClipboardChangeCount?.() ?? null;
  } catch {
    return null;
  }
}

async function writeClipboardText(text: string): Promise<number | null> {
  if (/[^\x00-\x7F]/.test(text)) {
    clipboard.writeText(text);
    if (clipboard.readText() === text) return clipboardChangeCount();
  }

  try {
    execFileSync("pbcopy", [], { input: text, encoding: "utf8", env: UTF8_CLIPBOARD_ENV });
  } catch {
    clipboard.writeText(text);
  }
  try {
    return clipboard.readText() === text ? clipboardChangeCount() : null;
  } catch {
    return null;
  }
}

async function restoreClipboardAfterDelay(original: string, ownedChangeCount: number, delayMs: number, generation: number): Promise<void> {
  await delay(delayMs);
  // A newer injection started after this one; let it own the clipboard.
  if (generation !== restoreGeneration) return;
  pendingRestore = null;
  // Text equality cannot distinguish a user copy of the same dictated text.
  // Restore only while the pasteboard still has our last observed change count.
  if (clipboardChangeCount() === ownedChangeCount) {
    await writeClipboardText(original);
  }
}

async function maybeRestoreCaretAfterInsertion(_text: string, _target: InjectionTarget | undefined, _kind: "paste" | "typing", _activationSucceeded?: boolean): Promise<void> {
  // DISABLED: Caret restoration was causing cursor to jump to wrong lines.
  //
  // The root cause: selection info captured at dictation start becomes stale by
  // injection time. Apps move cursor during typing, and multiline text length
  // calculation doesn't account for how different apps handle newlines.
  //
  // Modern apps handle cursor positioning correctly after paste/type operations.
  // Forcing caret position causes more problems than it solves:
  // - Cursor jumps 3 lines above in some apps
  // - Cursor snaps to end of document in others
  // - Selection state is often unreliable across app activation boundaries
  //
  // Let the target app handle cursor positioning naturally.
  return;
}

async function confirmInsertion(_text: string, target: InjectionTarget | undefined, _kind: "paste" | "typing", guard: InjectionGuard): Promise<boolean> {
  if (!target?.selection || !nativeBridge.getFocusedSelection) {
    // When we have no selection tracking (terminals, many clipboard-only apps),
    // assume the first method that "ran" succeeded rather than chaining through
    // all fallbacks and potentially inserting text multiple times.
    return true;
  }

  // For clipboard-only targets, assume success to avoid double-paste issues
  if (isClipboardOnlyTarget(target)) {
    return true;
  }

  // Use consistent delay for all text lengths - give the app time to process
  const delays = [100, 200, 350];

  for (const waitMs of delays) {
    await delay(waitMs);
    if (guard() || !isTargetFrontmost(target)) {
      return false;
    }

    try {
      const current = nativeBridge.getFocusedSelection();
      // Be more lenient: allow cursor to be anywhere after the original position
      // This handles cases where the editor has custom behavior
      if (current && current.length === 0 && current.location >= target.selection.location) {
        return true;
      }
    } catch {
      return false;
    }
  }

  // If we get here, assume success if target is still frontmost
  // This prevents false negatives that cause double-insertion issues
  return !guard() && isTargetFrontmost(target);
}

function toAppleScriptString(text: string): string {
  return text
    .split("\n")
    .map(part => `"${part.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(" & return & ");
}

async function ensureTargetReady(target?: InjectionTarget): Promise<boolean> {
  const activated = await activateTargetApp(target);
  const settleDelay = isClipboardOnlyTarget(target) ? 620 : Math.min(1_050, 450 + consecutiveFailures * 200);
  if (activated) {
    await delay(settleDelay);
  }

  if (!target || isTargetFrontmost(target)) {
    return activated;
  }

  await activateTargetApp(target);
  await delay(settleDelay);
  return true;
}
