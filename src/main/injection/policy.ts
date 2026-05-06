export interface InjectionTargetLike {
  appBundleId: string | null;
  appName: string | null;
}

const CLIPBOARD_ONLY_TOKENS = [
  "electron",
  "antigravity",
  "codex",
  "chrome",
  "arc",
  "firefox",
  "safari",
  "slack",
  "discord",
  "notion",
  "cursor",
  "windsurf",
  "zed",
  "figma",
  "whatsapp",
  "telegram",
  "signal",
  "messages",
  // ChatGPT / OpenAI web interfaces (runs in Chrome/Arc/etc but explicitly listed)
  "chatgpt",
  "openai",
  // Terminal emulators — don't expose AX text editing attributes
  "terminal",
  "iterm",
  "warp",
  "hyper",
  "ghostty",
  "alacritty",
  "kitty"
];

// Terminal apps need paste-only injection (no confirmation fallback chain)
const TERMINAL_TOKENS = [
  "terminal",
  "iterm",
  "warp",
  "hyper",
  "ghostty",
  "alacritty",
  "kitty"
];

const BROWSER_TOKENS = [
  "chrome",
  "arc",
  "firefox",
  "safari"
];

export function isTerminalTarget(target?: InjectionTargetLike): boolean {
  const haystack = `${target?.appBundleId ?? ""} ${target?.appName ?? ""}`.toLowerCase();
  return TERMINAL_TOKENS.some((token) => haystack.includes(token));
}

export function isBrowserTarget(target?: InjectionTargetLike): boolean {
  const haystack = `${target?.appBundleId ?? ""} ${target?.appName ?? ""}`.toLowerCase();
  return BROWSER_TOKENS.some((token) => haystack.includes(token));
}

const SPECIAL_PASTE_CHARACTERS = /[@#[\]{}<>`~^&*|\\\n\t]/;
const TYPING_PREFERRED_TOKENS = ["whatsapp", "antigravity", "telegram", "signal"];

export function isClipboardOnlyTarget(target?: InjectionTargetLike): boolean {
  const haystack = `${target?.appBundleId ?? ""} ${target?.appName ?? ""}`.toLowerCase();
  return CLIPBOARD_ONLY_TOKENS.some((token) => haystack.includes(token));
}

export function shouldPreferClipboardInjection(text: string, target?: InjectionTargetLike): boolean {
  if (/[^\x00-\x7F]/.test(text) || SPECIAL_PASTE_CHARACTERS.test(text)) {
    return true;
  }

  return isClipboardOnlyTarget(target);
}

export function shouldPreferTypingInjection(target?: InjectionTargetLike): boolean {
  const haystack = `${target?.appBundleId ?? ""} ${target?.appName ?? ""}`.toLowerCase();
  return TYPING_PREFERRED_TOKENS.some((token) => haystack.includes(token));
}
