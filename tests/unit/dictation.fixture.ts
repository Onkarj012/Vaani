import { vi } from "vitest";

vi.mock("/Users/onkarj012/Projects/Alternatives/claude_vaani/src/main/overlay.ts", () => ({
  OverlayController: class OverlayControllerMock {}
}));

vi.mock("/Users/onkarj012/Projects/Alternatives/claude_vaani/src/main/store/history.ts", () => ({
  HistoryStore: class HistoryStoreMock {}
}));

vi.mock("/Users/onkarj012/Projects/Alternatives/claude_vaani/src/main/store/settings.ts", () => ({
  SettingsStore: class SettingsStoreMock {}
}));

vi.mock("/Users/onkarj012/Projects/Alternatives/claude_vaani/src/main/injection/index.ts", () => ({
  TextInjector: class TextInjectorMock {}
}));

vi.mock("/Users/onkarj012/Projects/Alternatives/claude_vaani/src/main/injection/accessibility.ts", () => ({
  AccessibilityTextInjector: class AccessibilityTextInjectorMock {}
}));

vi.mock("/Users/onkarj012/Projects/Alternatives/claude_vaani/src/main/injection/clipboard.ts", () => ({
  ClipboardTextInjector: class ClipboardTextInjectorMock {}
}));

vi.mock("/Users/onkarj012/Projects/Alternatives/claude_vaani/src/main/nativeBridge.ts", () => ({
  nativeBridge: {}
}));

const dictationModule = await import("@main/dictation");

export const DictationService = dictationModule.DictationService;
