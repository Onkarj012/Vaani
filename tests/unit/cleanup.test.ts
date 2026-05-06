import { describe, expect, it } from "vitest";
import type { Settings } from "@shared/types";
import { cleanupText } from "@main/text/cleanup";

function createSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    groqApiKey: "test-key",
    primaryHotkey: "Cmd+D",
    pasteLatestHotkey: "Ctrl+Cmd+V",
    language: "en",
    cleanupEnabled: true,
    smartPunctuation: true,
    fillerWords: [],
    customCorrections: [],
    snippets: [],
    injectionMode: "auto",
    pasteMode: "instant",
    theme: "signal",
    launchAtLogin: false,
    showInDock: true,
    minClipDuration: 0.5,
    silenceThreshold: 0.01,
    ...overrides
  };
}

describe("cleanupText", () => {
  it("preserves numbered list formatting across lines", () => {
    const result = cleanupText({
      rawText: "1. buy milk\n2. call mom\n3. ship update",
      settings: createSettings()
    });

    expect(result).toBe("1. Buy milk\n2. Call mom\n3. Ship update");
  });

  it("preserves bulleted list formatting across lines", () => {
    const result = cleanupText({
      rawText: "- first item\n- second item\n- third item",
      settings: createSettings()
    });

    expect(result).toBe("- First item\n- Second item\n- Third item");
  });

  it("still normalizes plain paragraph text", () => {
    const result = cleanupText({
      rawText: "hello   world",
      settings: createSettings()
    });

    expect(result).toBe("Hello world.");
  });

  it("expands slash command snippets", () => {
    const result = cleanupText({
      rawText: "my email is /address",
      settings: createSettings({
        snippets: [{ trigger: "address", content: "onkarj012@gmail.com" }]
      })
    });

    expect(result).toBe("My email is onkarj012@gmail.com.");
  });

  it("does not expand snippets without leading slash", () => {
    const result = cleanupText({
      rawText: "my address is here",
      settings: createSettings({
        snippets: [{ trigger: "address", content: "onkarj012@gmail.com" }]
      })
    });

    expect(result).toBe("My address is here.");
  });

  it("expands snippets in multiline text", () => {
    const result = cleanupText({
      rawText: "contact me\n/email\nthanks",
      settings: createSettings({
        snippets: [{ trigger: "email", content: "onkarj012@gmail.com" }]
      })
    });

    expect(result).toBe("Contact me.\nOnkarj012@gmail.com.\nThanks.");
  });
});
