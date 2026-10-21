import { afterEach, describe, expect, it, vi } from "vitest";
import { clipboard } from "electron";
import { snippetPlaceholderResolver } from "@main/dictation";
import { cleanupText } from "@main/text/cleanup";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { Settings } from "@shared/types";

const clipboardSnippet = { trigger: "template", content: "copied {{clipboard}} and {{clipboard}}" };

function settings(overrides: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
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

  it("reads the clipboard once and expands every placeholder when the snippet triggers", async () => {
    const read = vi.spyOn(clipboard, "readText").mockResolvedValue("hello");
    const resolve = await snippetPlaceholderResolver(settings({ snippets: [clipboardSnippet] }), "/template", null);
    expect(read).toHaveBeenCalledTimes(1);
    expect(cleanupText({
      rawText: "/template",
      settings: settings({ snippets: [clipboardSnippet] }),
      placeholderResolver: resolve,
    })).toBe("Copied hello and hello.");
  });
});
