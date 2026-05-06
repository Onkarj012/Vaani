import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { clipboard } from "electron";
import type { InjectionResult } from "@shared/types";
import { nativeBridge } from "../nativeBridge";
import type { InjectionTarget } from "./index";
import { isClipboardOnlyTarget, shouldPreferTypingInjection } from "./policy";
import { activateTargetApp, isTargetFrontmost } from "./target";

const exec = promisify(execFile);
let consecutiveFailures = 0;

export class ClipboardTextInjector {
  async inject(text: string, target?: InjectionTarget): Promise<InjectionResult> {
    const original = await readClipboardText();
    try {
      await writeClipboardText(text);
      await delay(180);

      // Clipboard-only apps (terminals, browsers, Electron apps, etc.) have no AX
      // selection tracking. Running the full fallback chain would fire multiple
      // paste methods causing text to appear multiple times. For these apps:
      // one shot, then return immediately.
      // IMPORTANT: Use AppleScript Cmd+V paste instead of nativeBridge.pasteText()
      // because pbcopy (used in writeClipboardText above) properly preserves
      // newlines and formatting. nativeBridge.pasteText() may re-write the
      // clipboard in a way that strips structural formatting (newlines, lists).
      if (isClipboardOnlyTarget(target)) {
        await ensureTargetReady(target);
        await moveCaretToEndForBrowserTarget(target);
        const ok = await this.pasteWithAppleScript(target);
        // For clipboard-only targets, immediately restore the original clipboard
        // to prevent the app from re-firing a paste with the same content.
        // This closes the window where a second cmd+v or app-triggered paste duplicates.
        if (ok) {
          // Small delay to let the paste complete, then immediately clear
          await delay(80);
          if (original !== text) {
            await writeClipboardText(original);
          } else {
            // Even if text matches original, briefly clear to break any paste loops
            await writeClipboardText("");
            await delay(50);
            await writeClipboardText(original);
          }
        }
        if (ok) {
          consecutiveFailures = 0;
          return { success: true, method: "clipboard" };
        }
        consecutiveFailures += 1;
        return { success: false, reason: "insertion_failed" };
      }

      const methods = shouldPreferTypingInjection(target)
        ? [
            { name: "type-native", run: () => this.typeWithNativeBridge(text, target), kind: "typing" as const },
            { name: "type-applescript", run: () => this.typeWithAppleScript(text, target), kind: "typing" as const },
            { name: "paste-applescript", run: () => this.pasteWithAppleScript(target), kind: "paste" as const },
            { name: "paste-native", run: () => this.pasteWithNativeBridge(text, target), kind: "paste" as const }
          ]
        : prefersSystemEventsPaste(target)
        ? [
            { name: "paste-applescript", run: () => this.pasteWithAppleScript(target), kind: "paste" as const },
            { name: "type-native", run: () => this.typeWithNativeBridge(text, target), kind: "typing" as const },
            { name: "type-applescript", run: () => this.typeWithAppleScript(text, target), kind: "typing" as const },
            { name: "paste-native", run: () => this.pasteWithNativeBridge(text, target), kind: "paste" as const }
          ]
        : [
            { name: "paste-native", run: () => this.pasteWithNativeBridge(text, target), kind: "paste" as const },
            { name: "paste-applescript", run: () => this.pasteWithAppleScript(target), kind: "paste" as const },
            { name: "type-native", run: () => this.typeWithNativeBridge(text, target), kind: "typing" as const },
            { name: "type-applescript", run: () => this.typeWithAppleScript(text, target), kind: "typing" as const }
          ];

      let pasted = false;
      for (const method of methods) {
        const attempted = await method.run();
        pasted = attempted && await confirmInsertion(text, target, method.kind);
        if (pasted) {
          await maybeRestoreCaretAfterInsertion(text, target, method.kind);
          break;
        }
      }

      await delay(600);
      if (pasted) {
        consecutiveFailures = 0;
        return { success: true, method: "clipboard" };
      }
      consecutiveFailures += 1;
      return { success: false, reason: "insertion_failed" };
    } finally {
      if (original !== text) {
        // Restore quickly (400ms) to minimize the window where, if the app re-fires
        // a paste, it gets the dictated text a second time. For non-clipboard-only
        // targets, this is faster than the previous 750ms to reduce double-paste risk.
        void restoreClipboardAfterDelay(original, text, 400);
      }
    }
  }

  private async pasteWithNativeBridge(text: string, target?: InjectionTarget): Promise<boolean> {
    if (!nativeBridge.pasteText) return false;
    try {
      await ensureTargetReady(target);
      await releaseModifiers();
      await delay(60);
      return nativeBridge.pasteText(text);
    } catch { return false; }
  }

  private async pasteWithAppleScript(target?: InjectionTarget): Promise<boolean> {
    try {
      const lines = [...modifierReleaseLines(), "delay 0.05", 'tell application "System Events" to key code 9 using {command down}'];
      if (await ensureTargetReady(target)) {
        lines.unshift("delay 0.05");
      }
      await exec("osascript", lines.flatMap(l => ["-e", l]));
      return true;
    } catch { return false; }
  }

  private async typeWithNativeBridge(text: string, target?: InjectionTarget): Promise<boolean> {
    if (!nativeBridge.typeText) return false;
    try {
      await ensureTargetReady(target);
      await releaseModifiers();
      await delay(60);
      return nativeBridge.typeText(text);
    } catch {
      return false;
    }
  }

  private async typeWithAppleScript(text: string, target?: InjectionTarget): Promise<boolean> {
    try {
      const lines = [...modifierReleaseLines(), "delay 0.05", `tell application "System Events" to keystroke ${toAppleScriptString(text)}`];
      if (await ensureTargetReady(target)) {
        lines.unshift("delay 0.05");
      }
      await exec("osascript", lines.flatMap(l => ["-e", l]));
      return true;
    } catch {
      return false;
    }
  }
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
    const result = await exec("pbpaste", []);
    return result.stdout;
  } catch {
    return clipboard.readText();
  }
}

async function writeClipboardText(text: string): Promise<void> {
  try {
    execFileSync("pbcopy", [], { input: text, encoding: "utf8" });
  } catch {
    clipboard.writeText(text);
  }
}

async function restoreClipboardAfterDelay(original: string, injected: string, delayMs: number): Promise<void> {
  await delay(delayMs);
  const current = await readClipboardText();
  // Only restore if clipboard still contains our injected text.
  // If it's different, something else changed it (user copied something else).
  if (current === injected) {
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

async function confirmInsertion(_text: string, target: InjectionTarget | undefined, _kind: "paste" | "typing"): Promise<boolean> {
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
    if (!isTargetFrontmost(target)) {
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
  return isTargetFrontmost(target);
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

async function moveCaretToEndForBrowserTarget(_target?: InjectionTarget): Promise<void> {
  // DISABLED: This was moving cursor to end of document (Cmd+Down) before paste,
  // causing text to be inserted at wrong location instead of where user's cursor was.
  //
  // The original intent was to work around browser text field quirks, but it caused
  // more problems than it solved:
  // - User positions cursor in middle of text
  // - We move it to end
  // - Text pastes at end, not where user intended
  //
  // Let the browser handle cursor position naturally.
  return;
}


