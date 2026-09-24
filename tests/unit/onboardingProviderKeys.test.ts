import { describe, expect, it } from "vitest";
import { decideProviderKeyDraft } from "@renderer/lib/providerKeyDraft";

describe("onboarding provider key drafts", () => {
  it.each([
    ["blank", ""],
    ["redacted renderer value", ""],
    ["whitespace-only", " \t\n "],
  ])("preserves a stored credential for a %s field", (_case, value) => {
    expect(decideProviderKeyDraft(value, "blur")).toBe("preserve");
  });

  it("saves a nonblank replacement credential", () => {
    expect(decideProviderKeyDraft("  replacement-key  ", "blur")).toBe("save");
  });
});
