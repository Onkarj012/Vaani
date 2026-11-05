// What a key does while the snippet or dictionary prompt is focused.
// Escape skips (matching Skip, the close control, and the auto-dismiss), or backs out of Edit.
// Enter is left to whichever button is focused so a leftover key cannot save a rule.
// The one exception is Enter inside an edit field, which submits the edit the user is typing.
export type PromptKeyAction = "skip" | "back" | "submit" | null;

export function overlayPromptKeyAction(
  key: string,
  context: { editing?: boolean; inField?: boolean; inTextarea?: boolean; shiftKey?: boolean; composing?: boolean } = {},
): PromptKeyAction {
  // Enter and Escape during IME composition confirm or cancel the candidate, not the prompt.
  if (context.composing) return null;
  if (key === "Escape") return context.editing ? "back" : "skip";
  if (key === "Enter" && context.editing && context.inField && !(context.inTextarea && context.shiftKey)) return "submit";
  return null;
}

// Focus the card when React commits it. Null means the card is not in the document yet.
export function focusMountedPrompt(node: { focus(): void } | null): boolean {
  if (!node) return false;
  node.focus();
  return true;
}

// Next control while Tab stays inside the prompt. -1 means focus is on the dialog itself.
export function nextPromptFocusIndex(current: number, count: number, shiftKey: boolean): number {
  if (count <= 0) return 0;
  if (shiftKey) return current <= 0 ? count - 1 : current - 1;
  if (current < 0 || current >= count - 1) return 0;
  return current + 1;
}

// Countdown left after `elapsedMs`, frozen while held (hover, keyboard focus, or editing).
export function nextCountdown(remainingMs: number, elapsedMs: number, held: boolean): number {
  return held ? remainingMs : Math.max(0, remainingMs - elapsedMs);
}
