import { vi } from "vitest";

vi.mock("@main/overlay", () => ({
  OverlayController: class OverlayControllerMock {}
}));

vi.mock("@main/store/history", () => ({
  HistoryStore: class HistoryStoreMock {}
}));

vi.mock("@main/store/settings", () => ({
  SettingsStore: class SettingsStoreMock {}
}));

vi.mock("@main/injection/accessibility", () => ({
  AccessibilityTextInjector: class AccessibilityTextInjectorMock {}
}));

vi.mock("@main/injection/clipboard", () => ({
  ClipboardTextInjector: class ClipboardTextInjectorMock {}
}));

vi.mock("@main/nativeBridge", () => ({
  nativeBridge: {}
}));

const dictationModule = await import("@main/dictation");

export const DictationService = dictationModule.DictationService;
