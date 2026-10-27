const MOD_SYMBOL: Record<string, string> = {
  Cmd: "⌘", Command: "⌘", Ctrl: "⌃", Control: "⌃",
  Option: "⌥", Alt: "⌥", Shift: "⇧", Fn: "fn",
}

// Splits a stored hotkey ("Cmd+Shift+Space") into display glyphs (["⌘", "⇧", "Space"]).
export function hotkeyDisplayParts(combo: string): string[] {
  return combo.split("+").filter(Boolean).map((part) => MOD_SYMBOL[part] ?? part)
}
