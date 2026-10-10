import { describe, expect, it } from "vitest";
import { applyDictionary, cleanupText } from "@main/text/cleanup";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { Settings } from "@shared/types";

function settings(overrides: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("Phase 3 dictionary and snippet behavior", () => {
  it.each([
    ["accepts fuzzy phonetic match", "fone", "phone", "Phone"],
    ["rejects fuzzy when entry is not opted in", "fone", "phone", "fone"],
    ["rejects fuzzy phonetic mismatch", "tree", "phone", "tree"],
    ["rejects fuzzy ratio above threshold", "abcdefgh", "abcde", "abcdefgh"],
    ["rejects fuzzy absolute distance above two", "abcdefghij", "abcdefgh", "abcdefghij"],
    ["rejects fuzzy spoken forms shorter than four characters", "fon", "phone", "fon"],
  ])("%s", (_name, input, spoken, expected) => {
    const fuzzy = _name === "rejects fuzzy when entry is not opted in" ? undefined : true;
    expect(applyDictionary(input, settings({ customCorrections: [{ spoken, written: "Phone", fuzzy }] }))).toBe(expected);
  });

  it("uses opted-in bare triggers and guards ineligible triggers", () => {
    expect(cleanupText({ rawText: "please use long phrase today", settings: settings({ snippets: [{ trigger: "long phrase", content: "expanded", matchBareTrigger: true }] }) })).toBe("Please use expanded today.");
    expect(cleanupText({ rawText: "please use email today", settings: settings({ snippets: [{ trigger: "email", content: "expanded", matchBareTrigger: true }] }) })).toBe("Please use email today.");
    expect(cleanupText({ rawText: "please use long phrase today", settings: settings({ snippets: [{ trigger: "long phrase", content: "expanded", matchBareTrigger: false }] }) })).toBe("Please use long phrase today.");
  });

  it("resolves overlapping dictionary rules against the original text once", () => {
    expect(applyDictionary("new york city", settings({ customCorrections: [
      { spoken: "new york", written: "NY" },
      { spoken: "new york city", written: "New York City" },
    ] }))).toBe("New York City");
  });

  it("resolves supported snippet placeholders through the supplied resolver", () => {
    expect(cleanupText({
      rawText: "/template",
      settings: settings({ snippets: [{ trigger: "template", content: "Date {{date}}, time {{time}}, clip {{clipboard}}" }] }),
      placeholderResolver: name => ({ date: "D", time: "T", clipboard: "C" })[name],
    })).toBe("Date D, time T, clip C.");
  });

  it("applies app-scoped snippets only to their profile", () => {
    const snippet = { trigger: "profile phrase", content: "expanded", matchBareTrigger: true, appProfileIds: ["work"] };
    expect(cleanupText({ rawText: "profile phrase", settings: settings({ snippets: [snippet] }), appProfileId: "work" })).toBe("Expanded.");
    expect(cleanupText({ rawText: "profile phrase", settings: settings({ snippets: [snippet] }), appProfileId: "home" })).toBe("Profile phrase.");
  });
});
