export type HotkeyParseResult =
  | { ok: true; hotkey: string }
  | { ok: false; message: string };

export interface HotkeyKeyEvent {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_ALIASES = new Map<string, string>([
  ["cmd", "Cmd"], ["command", "Cmd"], ["meta", "Cmd"],
  ["ctrl", "Ctrl"], ["control", "Ctrl"],
  ["option", "Option"], ["opt", "Option"], ["alt", "Option"],
  ["shift", "Shift"],
]);

const NAMED_KEYS = new Map<string, string>([
  ["space", "Space"], ["return", "Return"], ["enter", "Return"],
  ["tab", "Tab"], ["escape", "Escape"], ["esc", "Escape"],
  ["up", "Up"], ["arrowup", "Up"], ["down", "Down"], ["arrowdown", "Down"],
  ["left", "Left"], ["arrowleft", "Left"], ["right", "Right"], ["arrowright", "Right"],
]);

const KEY_HELP = "Use a letter, number, F1 to F20, Space, Return, Tab, Escape, or an arrow key.";

// Turns a hotkey string into the form native code registers, or says why it cannot be used.
export function parseHotkey(input: string): HotkeyParseResult {
  if (input.trim() === "") return refused("Press a key or key combination.");
  const parts = input.split("+").map((part) => part.trim());
  if (parts.some((part) => part === "")) {
    return refused("Remove the extra \"+\" signs from the hotkey.");
  }
  if (parts.some((part) => part.toLowerCase() === "fn" || part.toLowerCase() === "function")) {
    return parts.length === 1
      ? { ok: true, hotkey: "Fn" }
      : refused("Fn works only by itself for now. Choose Fn alone, or pick another key.");
  }

  const names: string[] = [];
  let key: string | null = null;
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES.get(part.toLowerCase());
    if (modifier) {
      if (!names.includes(modifier)) names.push(modifier);
      continue;
    }
    const keyName = canonicalKey(part);
    if (!keyName) return refused(`"${part}" can't be used as a hotkey. ${KEY_HELP}`);
    if (key) return refused("Use only one key with modifiers, such as Cmd+Shift+D.");
    key = keyName;
  }

  if (!key) return refused("Add a key to the modifiers. Vaani can't register modifier-only shortcuts.");
  return { ok: true, hotkey: [...names, key].join("+") };
}

// True when a stored hotkey is already in the form native code registers.
export function isCanonicalHotkey(value: string): boolean {
  const result = parseHotkey(value);
  return result.ok && result.hotkey === value;
}

// Builds a hotkey from a key press, using the physical key so Option+D still reads as D.
export function hotkeyFromKeyEvent(event: HotkeyKeyEvent): HotkeyParseResult {
  const parts: string[] = [];
  if (event.metaKey) parts.push("Cmd");
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Option");
  if (event.shiftKey) parts.push("Shift");
  parts.push(keyNameFromEvent(event));
  return parseHotkey(parts.join("+"));
}

// Returns the key name for a press, or the raw key when no physical name applies.
function keyNameFromEvent(event: HotkeyKeyEvent): string {
  const physical = /^(?:Key|Digit)([A-Z0-9])$/.exec(event.code);
  if (physical?.[1]) return physical[1];
  return event.key === " " ? "Space" : event.key;
}

// Maps one key name to its canonical form, or null when native code cannot register it.
function canonicalKey(part: string): string | null {
  const lower = part.toLowerCase();
  const named = NAMED_KEYS.get(lower);
  if (named) return named;
  if (/^[a-z0-9]$/.test(lower) || /^f(?:[1-9]|1[0-9]|20)$/.test(lower)) return lower.toUpperCase();
  return null;
}

// Builds the failed result for a hotkey native code cannot use.
function refused(message: string): HotkeyParseResult {
  return { ok: false, message };
}
