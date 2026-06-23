import { describe, expect, it } from "vitest";
import type { Settings } from "@shared/types";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import { cleanupText } from "@main/text/cleanup";

function createSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
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
    theme: "aurora",
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

  it("normalizes a common standalone number to a digit", () => {
    expect(cleanupText({
      rawText: "I need ten apples",
      settings: createSettings()
    })).toBe("I need 10 apples.");
  });

  it("normalizes a compound number with a percent phrase", () => {
    expect(cleanupText({
      rawText: "Set the limit to twenty five percent",
      settings: createSettings()
    })).toBe("Set the limit to 25%.");
  });

  it("normalizes a simple dollar amount phrase", () => {
    expect(cleanupText({
      rawText: "The budget is ten dollars",
      settings: createSettings()
    })).toBe("The budget is $10.");
  });

  it("leaves the idiomatic standalone 'one' as a word", () => {
    expect(cleanupText({
      rawText: "I have one more thing",
      settings: createSettings()
    })).toBe("I have one more thing.");
  });

  it("does not normalize numbers when cleanup is disabled", () => {
    expect(cleanupText({
      rawText: "I need ten apples",
      settings: createSettings({ cleanupEnabled: false })
    })).toBe("I need ten apples");
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

describe("applySnippets — spoken marker", () => {
  const cases: Array<{ name: string; raw: string; snippets: Array<{ trigger: string; content: string }>; expected: string }> = [
    {
      name: "snippet marker at start",
      raw: "snippet email is the best way",
      snippets: [{ trigger: "email", content: "hi@example.com" }],
      expected: "Hi@example.com is the best way.",
    },
    {
      name: "snippet marker mid-sentence",
      raw: "contact me at snippet email please",
      snippets: [{ trigger: "email", content: "hi@example.com" }],
      expected: "Contact me at hi@example.com please.",
    },
    {
      name: "snippet marker at end",
      raw: "my address is snippet email",
      snippets: [{ trigger: "email", content: "hi@example.com" }],
      expected: "My address is hi@example.com.",
    },
    {
      name: "slash marker no longer expands (spoken 'slash' is ordinary speech)",
      raw: "send to slash email now",
      snippets: [{ trigger: "email", content: "hi@example.com" }],
      expected: "Send to slash email now.",
    },
    {
      name: "inserted content is not re-expanded (no double-expansion)",
      raw: "use snippet greeting here",
      snippets: [
        { trigger: "greeting", content: "say snippet email to start" },
        { trigger: "email", content: "hi@example.com" },
      ],
      expected: "Use say snippet email to start here.",
    },
    {
      name: "typed snippet body containing spoken marker is not re-expanded (no cross-form cascade)",
      raw: "use /greeting here",
      snippets: [
        { trigger: "greeting", content: "say snippet email to start" },
        { trigger: "email", content: "hi@example.com" },
      ],
      expected: "Use say snippet email to start here.",
    },
    {
      name: "case-insensitive marker",
      raw: "use SNIPPET Email here",
      snippets: [{ trigger: "email", content: "hi@example.com" }],
      expected: "Use hi@example.com here.",
    },
    {
      name: "case-insensitive trigger name",
      raw: "use snippet EMAIL here",
      snippets: [{ trigger: "email", content: "hi@example.com" }],
      expected: "Use hi@example.com here.",
    },
    {
      name: "unknown name leaves transcript unchanged",
      raw: "use snippet unknown here",
      snippets: [{ trigger: "email", content: "hi@example.com" }],
      expected: "Use snippet unknown here.",
    },
    {
      name: "multiple snippets expand",
      raw: "from snippet name to snippet email",
      snippets: [
        { trigger: "name", content: "Alice" },
        { trigger: "email", content: "alice@example.com" },
      ],
      expected: "From Alice to alice@example.com.",
    },
    {
      name: "longest name wins on overlap",
      raw: "use snippet emailsig now",
      snippets: [
        { trigger: "email", content: "SHORT" },
        { trigger: "emailsig", content: "LONG" },
      ],
      expected: "Use LONG now.",
    },
    {
      name: "no trigger residue remains",
      raw: "snippet sig at end",
      snippets: [{ trigger: "sig", content: "Best regards" }],
      expected: "Best regards at end.",
    },
    {
      name: "typed slash form still works (regression)",
      raw: "contact /email for info",
      snippets: [{ trigger: "email", content: "hi@example.com" }],
      expected: "Contact hi@example.com for info.",
    },
    {
      name: "spoken marker after punctuation",
      raw: "hello, snippet email please",
      snippets: [{ trigger: "email", content: "hi@example.com" }],
      expected: "Hello, hi@example.com please.",
    },
  ]

  for (const { name, raw, snippets, expected } of cases) {
    it(name, () => {
      const result = cleanupText({
        rawText: raw,
        settings: createSettings({ snippets }),
      })
      expect(result).toBe(expected)
    })
  }
})
