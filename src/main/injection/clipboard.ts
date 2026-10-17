import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clipboard } from "electron";
import type { InjectionResult } from "@shared/types";
import { warn } from "@main/log";
import { nativeBridge } from "../nativeBridge";
import type { PasteboardItem } from "../nativeBridge";
import type { InjectionTarget } from "./index";
import { isClipboardOnlyTarget, shouldPreferTypingInjection } from "./policy";
import { activateTargetApp, isTargetFrontmost } from "./target";
import type { InjectionBlockReason, InjectionGuard } from "./guard";
import { moveCaretAfterInsertion, readFocusedSelection } from "./caret";

const exec = promisify(execFile);
let consecutiveFailures = 0;
const CLIPBOARD_RESTORE_DELAY_MS = 1_200;
// A helper that never returns would hold the shared injection queue forever.
const HELPER_TIMEOUT_MS = 3_000;
// Typing a long transcript through System Events can take several seconds.
const DISPATCH_TIMEOUT_MS = 20_000;
// Clipboards larger than this keep only their plain text, so the snapshot stays bounded.
export const PASTEBOARD_SNAPSHOT_MAX_BYTES = 50 * 1024 * 1024;
const PLAIN_TEXT_TYPE = "public.utf8-plain-text";
const CARET_SETTLE_MS = 300;
let restoreGeneration = 0;
let pendingCaretCheck: ReturnType<typeof setTimeout> | null = null;
// The user's items, plus the change count our own write left on the pasteboard.
let pendingRestore: { items: PasteboardItem[]; changeCount: number } | null = null;
let injectionQueue: Promise<void> | null = null;

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
    // A newer insert owns the caret now, so an older pending check must not move it.
    if (pendingCaretCheck) { clearTimeout(pendingCaretCheck); pendingCaretCheck = null; }
    let snapshot: PasteboardItem[] | null = null;
    let generation = restoreGeneration;
    let ownedChangeCount: number | null = null;
    let dispatchStarted = false;
    const markDispatch = (): void => { dispatchStarted = true; onDispatch?.(); };
    const dispatchGuard: InjectionGuard = () => guard() ?? (ownedChangeCount !== null && clipboardChangeCount() !== ownedChangeCount ? "cancelled" : null);
    try {
      await activateTargetApp(target);
      await delay(180);
      const blockedBeforeWrite = dispatchGuard();
      if (blockedBeforeWrite) return { success: false, reason: blockedBeforeWrite };
      // Snapshot right before the first write, so a copy made during activation is the one kept.
      snapshot = readClipboardSnapshot();
      if (!snapshot) return { success: false, reason: "insertion_failed" };
      const insertionStart = readFocusedSelection()?.location ?? target?.selection?.location;
      generation = ++restoreGeneration;
      const countBeforeWrite = clipboardChangeCount();
      ownedChangeCount = writeClipboardText(text);
      if (ownedChangeCount === null) {
        // A failed write may already have cleared the clipboard, so put the user's items back.
        if (clipboardChangeCount() !== countBeforeWrite) restoreClipboard(snapshot);
        return { success: false, reason: "insertion_failed" };
      }

      // Clipboard-only apps (terminals, browsers, Electron apps, etc.) have no AX
      // selection tracking. Running the full fallback chain would fire multiple
      // paste methods causing text to appear multiple times. For these apps:
      // one shot, then return immediately.
      // Dispatch once for targets whose AX value cannot confirm the paste.
      if (isClipboardOnlyTarget(target)) {
        const blockedBeforeActivation = dispatchGuard();
        if (blockedBeforeActivation) return { success: false, reason: blockedBeforeActivation };
        const outcome = await this.pasteWithNativeBridge(text, target, dispatchGuard, () => ownedChangeCount, markDispatch);
        if (outcome === "dispatched") {
          if (dispatchGuard()) return { success: false, reason: "outcome_uncertain" };
          consecutiveFailures = 0;
          // The paste lands asynchronously, so check the caret after the app applies it.
          pendingCaretCheck = setTimeout(() => { pendingCaretCheck = null; moveCaretAfterInsertion(text, insertionStart); }, CARET_SETTLE_MS);
          return { success: true, method: "clipboard" };
        }
        if (outcome !== "failed") return { success: false, reason: outcome };
        consecutiveFailures += 1;
        return { success: false, reason: "insertion_failed" };
      }

      const hasNonAscii = /[^\x00-\x7F]/.test(text);

      const methods = hasNonAscii
        ? [
            { name: "paste-native", run: () => this.pasteWithNativeBridge(text, target, dispatchGuard, () => ownedChangeCount, markDispatch), kind: "paste" as const }
          ]
        : shouldPreferTypingInjection(target)
        ? [
            { name: "type-native", run: () => this.typeWithNativeBridge(text, target, dispatchGuard, markDispatch), kind: "typing" as const },
            { name: "type-applescript", run: () => this.typeWithAppleScript(text, target, dispatchGuard, markDispatch), kind: "typing" as const },
            { name: "paste-native", run: () => this.pasteWithNativeBridge(text, target, dispatchGuard, () => ownedChangeCount, markDispatch), kind: "paste" as const }
          ]
        : prefersSystemEventsPaste(target)
        ? [
            { name: "paste-native", run: () => this.pasteWithNativeBridge(text, target, dispatchGuard, () => ownedChangeCount, markDispatch), kind: "paste" as const },
            { name: "type-native", run: () => this.typeWithNativeBridge(text, target, dispatchGuard, markDispatch), kind: "typing" as const },
            { name: "type-applescript", run: () => this.typeWithAppleScript(text, target, dispatchGuard, markDispatch), kind: "typing" as const },
          ]
        : [
            { name: "paste-native", run: () => this.pasteWithNativeBridge(text, target, dispatchGuard, () => ownedChangeCount, markDispatch), kind: "paste" as const },
            { name: "type-native", run: () => this.typeWithNativeBridge(text, target, dispatchGuard, markDispatch), kind: "typing" as const },
            { name: "type-applescript", run: () => this.typeWithAppleScript(text, target, dispatchGuard, markDispatch), kind: "typing" as const }
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
        moveCaretAfterInsertion(text, insertionStart);
        return { success: true, method: "clipboard" };
      }
      consecutiveFailures += 1;
      return { success: false, reason: "insertion_failed" };
    } finally {
      if (snapshot && ownedChangeCount !== null) {
        if (dispatchStarted) {
          pendingRestore = { items: snapshot, changeCount: ownedChangeCount };
          void restoreClipboardAfterDelay(snapshot, ownedChangeCount, CLIPBOARD_RESTORE_DELAY_MS, generation);
        } else {
          pendingRestore = null;
          if (clipboardChangeCount() === ownedChangeCount) restoreClipboard(snapshot);
        }
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
    // strategy can insert the same text a second time. A timeout counts the same way.
    try {
      onDispatch?.();
      await exec("osascript", lines.flatMap(l => ["-e", l]), { timeout: DISPATCH_TIMEOUT_MS });
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
      await exec("osascript", modifierReleaseLines().flatMap(line => ["-e", line]), { timeout: HELPER_TIMEOUT_MS });
      await delay(60);
    } catch {
      // best-effort only
    }
  }
}

// Returns the user's pasteboard items, or null if the pasteboard cannot be read.
function readClipboardSnapshot(): PasteboardItem[] | null {
  const changeCount = clipboardChangeCount();
  if (changeCount === null) return null;
  // While an earlier restore is still pending the clipboard holds that
  // injection's text, not the user's. Reuse the user's items from then.
  if (pendingRestore && changeCount === pendingRestore.changeCount) return pendingRestore.items;
  return readPasteboardItems();
}

// Reads every item natively. Over the size cap, keeps only the plain text.
function readPasteboardItems(): PasteboardItem[] | null {
  if (!nativeBridge.readPasteboard) return null;
  // A copy made during the read leaves stale, partial items, so read again until the clipboard holds still.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = clipboardChangeCount();
    const items = nativeBridge.readPasteboard(PASTEBOARD_SNAPSHOT_MAX_BYTES);
    if (before === null || clipboardChangeCount() !== before) continue;
    if (items) return items;
    warn("clipboard", `pasteboard exceeds ${PASTEBOARD_SNAPSHOT_MAX_BYTES} bytes; restoring plain text only`);
    return plainTextItems(clipboard.readText());
  }
  return null;
}

// Builds one plain-text item, or no items for empty text.
function plainTextItems(text: string): PasteboardItem[] {
  return text ? [[{ type: PLAIN_TEXT_TYPE, data: Buffer.from(text, "utf8") }]] : [];
}

// Returns the pasteboard change count, or null if it cannot be read.
function clipboardChangeCount(): number | null {
  try {
    return nativeBridge.getClipboardChangeCount?.() ?? null;
  } catch {
    return null;
  }
}

// Replaces the pasteboard with the given items. Returns the new change count, or null if the write failed.
function writeClipboardItems(items: PasteboardItem[]): number | null {
  return nativeBridge.writePasteboard?.(items) ?? null;
}

// Puts the dictated text on the pasteboard. Returns the change count only if the text was stored.
function writeClipboardText(text: string): number | null {
  const changeCount = writeClipboardItems(plainTextItems(text));
  return changeCount !== null && clipboard.readText() === text ? changeCount : null;
}

// Puts every saved item back. Falls back to the saved plain text if the native write fails.
function restoreClipboard(items: PasteboardItem[]): void {
  if (writeClipboardItems(items) !== null) return;
  clipboard.writeText(items.flat().find((entry) => entry.type === PLAIN_TEXT_TYPE)?.data.toString("utf8") ?? "");
}

async function restoreClipboardAfterDelay(items: PasteboardItem[], ownedChangeCount: number, delayMs: number, generation: number): Promise<void> {
  await delay(delayMs);
  // A newer injection started after this one; let it own the clipboard.
  if (generation !== restoreGeneration) return;
  pendingRestore = null;
  // Text equality cannot distinguish a user copy of the same dictated text.
  // Restore only while the pasteboard still has our last observed change count.
  if (clipboardChangeCount() === ownedChangeCount) restoreClipboard(items);
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
