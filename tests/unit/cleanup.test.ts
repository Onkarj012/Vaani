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

  it("collapses accidental adjacent duplicate words", () => {
    const result = cleanupText({
      rawText: "github github should only appear once",
      settings: createSettings()
    });

    expect(result).toBe("Github should only appear once.");
  });

  it("normalizes common LLM dictation artifacts", () => {
    const result = cleanupText({
      rawText: "send this to the llmn cleanup step",
      settings: createSettings()
    });

    expect(result).toBe("Send this to the LLM cleanup step.");
  });

  it("removes trailing Vaani from transcription", () => {
    expect(cleanupText({
      rawText: "hello world Vaani",
      settings: createSettings()
    })).toBe("Hello world.");

    expect(cleanupText({
      rawText: "testing this, vaani.",
      settings: createSettings()
    })).toBe("Testing this.");

    expect(cleanupText({
      rawText: "send the message vaani",
      settings: createSettings()
    })).toBe("Send the message.");
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
