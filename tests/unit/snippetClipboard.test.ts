import { afterEach, describe, expect, it, vi } from "vitest";
import { clipboard } from "electron";
import { snippetPlaceholderResolver } from "@main/dictation";
import { cleanupText } from "@main/text/cleanup";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { Settings, Snippet } from "@shared/types";

const clipboardSnippet: Snippet = { trigger: "template", content: "copied {{clipboard}} and {{clipboard}}" };

function settings(overrides: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

// Runs the real resolver and cleanup path, returning the output and how often the clipboard was read.
async function expandWithClipboard(rawText: string, snippets: Snippet[], appProfileId: string | null, clipboardValue: string) {
  const read = vi.spyOn(clipboard, "readText").mockResolvedValue(clipboardValue);
  const resolver = await snippetPlaceholderResolver(settings({ snippets }), rawText, appProfileId);
  const output = cleanupText({ rawText, settings: settings({ snippets }), appProfileId, placeholderResolver: resolver });
  return { output, reads: read.mock.calls.length };
}

describe("snippet clipboard placeholder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not read the clipboard when the text does not trigger the clipboard snippet", async () => {
    const read = vi.spyOn(clipboard, "readText").mockResolvedValue("secret");
    await snippetPlaceholderResolver(settings({ snippets: [clipboardSnippet] }), "just talking", null);
    expect(read).not.toHaveBeenCalled();
  });

  it("does not read the clipboard when the snippet is scoped to another app profile", async () => {
    const read = vi.spyOn(clipboard, "readText").mockResolvedValue("secret");
    const scoped = { ...clipboardSnippet, appProfileIds: ["work"] };
    await snippetPlaceholderResolver(settings({ snippets: [scoped] }), "/template", "home");
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ["typed slash form", "/template", { trigger: "template" }],
    ["spoken snippet form", "snippet template", { trigger: "template" }],
    ["spoken slash form", "slash template", { trigger: "template" }],
    ["eligible bare trigger", "please use long phrase today", { trigger: "long phrase", matchBareTrigger: true }],
    ["snippet scoped to the matching profile", "/template", { trigger: "template", appProfileIds: ["work"] }],
  ])("expands %s with the real clipboard text using one read", async (_name, rawText, overrides) => {
    const snippet: Snippet = { ...clipboardSnippet, ...overrides };
    const { output, reads } = await expandWithClipboard(rawText, [snippet], "work", "hello");
    expect(reads).toBe(1);
    expect(output).toMatch(/copied hello and hello/i);
    expect(output).not.toContain("{{clipboard}}");
  });

  it("shares one clipboard read across two clipboard expansions in one text", async () => {
    const { output, reads } = await expandWithClipboard("/template and snippet template", [clipboardSnippet], null, "hello");
    expect(reads).toBe(1);
    expect(output).toBe("Copied hello and hello and copied hello and hello.");
  });
});
