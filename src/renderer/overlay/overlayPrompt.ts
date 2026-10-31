// Keys handled while the snippet or dictionary prompt is focused.
// Escape skips, matching the Skip button, the close control, and the auto-dismiss.
// Enter is left to whichever button is focused so a leftover key cannot save a rule.
export function overlayPromptKeyAction(key: string): "skip" | null {
  if (key === "Escape") return "skip";
  return null;
}

// Next button while Tab stays inside the prompt. -1 means focus is on the dialog itself.
export function nextPromptFocusIndex(current: number, count: number, shiftKey: boolean): number {
  if (count <= 0) return 0;
  if (shiftKey) return current <= 0 ? count - 1 : current - 1;
  if (current < 0 || current >= count - 1) return 0;
  return current + 1;
}
