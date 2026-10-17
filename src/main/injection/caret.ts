import type { SelectionRange } from "@shared/types";
import { debug } from "@main/log";
import { nativeBridge } from "@main/nativeBridge";

// Reads the focused caret range, or null when the field cannot report one.
export function readFocusedSelection(): SelectionRange | null {
  try {
    return nativeBridge.getFocusedSelection?.() ?? null;
  } catch {
    return null;
  }
}

// Puts the caret after text just inserted at start when the app left it exactly at start.
export function moveCaretAfterInsertion(text: string, start: number | undefined): void {
  if (start === undefined) return;
  const end = start + text.length;
  let before = -1;
  let moved = false;
  try {
    const caret = readFocusedSelection();
    before = caret?.location ?? -1;
    const value = nativeBridge.getFocusedValue?.() ?? null;
    // Some Electron editors leave the caret at the paste start; any other position is the user's own move.
    const stale = caret !== null && caret.length === 0 && caret.location === start;
    // Never guess: move only when the field has our text exactly at start..end.
    if (stale && value?.slice(start, end) === text) {
      moved = nativeBridge.setFocusedSelection?.(end, 0) ?? false;
    }
  } catch {
    moved = false;
  }
  debug("injection", "insertion:caret", { start, end, before, moved });
}
