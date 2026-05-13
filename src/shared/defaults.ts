import type { Settings } from "./types";

export const DEFAULT_FILLER_WORDS = [
  "um", "uh", "like", "basically", "you know", "sort of", "kind of", "actually", "literally"
];

export const DEFAULT_SETTINGS: Settings = {
  groqApiKey: "",
  primaryHotkey: "Ctrl+Option+D",
  pasteLatestHotkey: "Ctrl+Cmd+V",
  language: "auto",
  cleanupEnabled: true,
  smartPunctuation: true,
  fillerWords: DEFAULT_FILLER_WORDS,
  customCorrections: [],
  snippets: [],
  injectionMode: "auto",
  pasteMode: "animated",
  theme: "aurora",
  colorMode: "light",
  accentColor: "#7C3AED",
  launchAtLogin: false,
  showInDock: true,
  minClipDuration: 0.5,
  silenceThreshold: 0.01,
  capsuleBorderWidth: 1,
  capsuleBarRadius: 2,
  capsuleCornerRadius: 20,
  capsuleDesign: "pill",
};

export const HISTORY_LIMIT = 2000;
export const SUCCESS_RESET_MS = 900;
export const ERROR_RESET_MS = 1_800;
export const HOTKEY_DOUBLE_PRESS_WINDOW_MS = 350;
export const APP_DATA_DIR = ".claude_vaani";
