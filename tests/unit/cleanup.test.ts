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

  it("preserves like as spoken content by default", () => {
    const result = cleanupText({
      rawText: "I like this.",
      settings: createSettings()
    });

    expect(result).toBe("I like this.");
  });

  it("removes only minimal built-in fillers by default", () => {
    expect(cleanupText({
      rawText: "um hello",
      settings: createSettings({ fillerWords: DEFAULT_SETTINGS.fillerWords })
    })).toBe("Hello.");

    expect(cleanupText({
      rawText: "umm hello uhh world",
      settings: createSettings({ fillerWords: DEFAULT_SETTINGS.fillerWords })
    })).toBe("Hello world.");
  });

  it("removes opt-in extra filler words when configured", () => {
    const result = cleanupText({
      rawText: "I basically like this",
      settings: createSettings({ extraFillerWords: ["basically"] })
    });

    expect(result).toBe("I like this.");
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
      rawText: "send this to the llmn cleanup step for the Vani app",
      settings: createSettings()
    });

    expect(result).toBe("Send this to the LLM cleanup step for the Vaani app.");
  });

  it("preserves trailing Vaani as spoken content", () => {
    expect(cleanupText({
      rawText: "hello world Vaani",
      settings: createSettings()
    })).toBe("Hello world Vaani.");

    expect(cleanupText({
      rawText: "testing this, vaani.",
      settings: createSettings()
    })).toBe("Testing this, vaani.");

    expect(cleanupText({
      rawText: "send the message vaani",
      settings: createSettings()
    })).toBe("Send the message vaani.");
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

  it("does not digitize standalone one before a capitalized hallucination segment", () => {
    expect(cleanupText({
      rawText: "one It should stay words",
      settings: createSettings()
    })).toBe("One It should stay words.");
  });

  it("keeps compound one-prefixed numeric contexts working", () => {
    expect(cleanupText({
      rawText: "one hundred users joined",
      settings: createSettings()
    })).toBe("100 users joined.");

    expect(cleanupText({
      rawText: "twenty one users joined",
      settings: createSettings()
    })).toBe("21 users joined.");
  });

  it("normalizes trailing compound number runs at terminal position", () => {
    expect(cleanupText({
      rawText: "the price is one fifty",
      settings: createSettings()
    })).toBe("The price is 51.");

    expect(cleanupText({
      rawText: "the total is one hundred",
      settings: createSettings()
    })).toBe("The total is 100.");

    expect(cleanupText({
      rawText: "the answer is twenty one",
      settings: createSettings()
    })).toBe("The answer is 21.");
  });

  it("keeps trailing standalone one as prose", () => {
    expect(cleanupText({
      rawText: "number one",
      settings: createSettings()
    })).toBe("Number one.");
  });

  it("does not normalize numbers when cleanup is disabled", () => {
    expect(cleanupText({
      rawText: "I need ten apples",
      settings: createSettings({ cleanupEnabled: false })
    })).toBe("I need ten apples");
  });

  it("converts a dangling list comma to a period instead of ',.'", () => {
    const result = cleanupText({
      rawText: "Decline press,\nIncline press,\nTricep,",
      settings: createSettings()
    });

    expect(result).toBe("Decline press.\nIncline press.\nTricep.");
    expect(result).not.toContain(",.");
  });

  it("formats paragraph blocks while preserving blank lines", () => {
    const result = cleanupText({
      rawText: "first paragraph line one\ncontinues here\n\nsecond paragraph starts\ncontinues too",
      settings: createSettings()
    });

    expect(result).toBe("First paragraph line one continues here.\n\nSecond paragraph starts continues too.");
  });

  it("preserves true list lines inside paragraph-separated text", () => {
    const result = cleanupText({
      rawText: "shopping list\n\n1. buy milk\n2. call mom",
      settings: createSettings()
    });

    expect(result).toBe("Shopping list.\n\n1. Buy milk\n2. Call mom");
  });

  it("applies dictionary corrections even when cleanup is disabled", () => {
    expect(cleanupText({
      rawText: "My name is Om Kar",
      settings: createSettings({
        cleanupEnabled: false,
        customCorrections: [{ spoken: "Om Kar", written: "Onkar" }]
      })
    })).toBe("My name is Onkar");
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

  it("converts spoken paragraph and line break cues deterministically", () => {
    const result = cleanupText({
      rawText: "intro sentence new paragraph first sentence should stay simple new line this should appear fresh new para final sentence",
      settings: createSettings()
    });

    expect(result).toBe([
      "Intro sentence.",
      "",
      "First sentence should stay simple.",
      "This should appear fresh.",
      "",
      "Final sentence.",
    ].join("\n"));
  });

  it("converts article-prefixed paragraph cues from STT artifacts", () => {
    const result = cleanupText({
      rawText: "important edge case a new paragraph here is another edge case",
      settings: createSettings()
    });

    expect(result).toBe("Important edge case.\n\nHere is another edge case.");
  });

  it("formats spoken point and number enumerations without breaking numeric prose", () => {
    const result = cleanupText({
      rawText: [
        "here are the things I want to test point one preserve every real word I say point two turn spoken enumeration into a real list point three do not add extra conclusions",
        "new paragraph now test a numbered list number one open the app number two start recording number three speak softly for one sentence number four stop recording after a short pause",
        "new paragraph I bought a number two pencil wrote point one percent in the margin and named the file Vani test notes",
      ].join(" "),
      settings: createSettings()
    });

    expect(result).toBe([
      "Here are the things I want to test.",
      "",
      "1. Preserve every real word I say",
      "2. Turn spoken enumeration into a real list",
      "3. Do not add extra conclusions",
      "",
      "Now test a numbered list.",
      "",
      "1. Open the app",
      "2. Start recording",
      "3. Speak softly for one sentence",
      "4. Stop recording after a short pause",
      "",
      "I bought a number 2 pencil wrote point 1% in the margin and named the file Vaani test notes.",
    ].join("\n"));
  });

  it("splits inline numbered list markers from STT output", () => {
    const result = cleanupText({
      rawText: "test a numbered list 1. Open the app 2. Start recording 3. Speak softly for one sentence 4 Stop recording after a short pause",
      settings: createSettings()
    });

    expect(result).toBe([
      "Test a numbered list.",
      "",
      "1. Open the app",
      "2. Start recording",
      "3. Speak softly for one sentence",
      "4. Stop recording after a short pause.",
    ].join("\n"));
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
