import { describe, expect, it } from "vitest";
import { editCorrection, editSnippet, normalizeAppProfileIds } from "../../src/shared/textRuleEdits";

describe("text rule edits", () => {
  it("preserves correction provenance, enabled state, and hit metadata while editing options", () => {
    const corrections = [{
      spoken: "Vaani", written: "Vaani", source: "auto-suggested" as const, enabled: false,
      hitCount: 7, lastUsedAt: "2026-09-01T00:00:00.000Z", wholeWord: true,
    }];

    expect(editCorrection(corrections, "vaani", {
      spoken: "Vaani AI", written: "Vaani AI", caseSensitive: true, fuzzy: true,
    })).toEqual([{
      spoken: "Vaani AI", written: "Vaani AI", source: "auto-suggested", enabled: false,
      hitCount: 7, lastUsedAt: "2026-09-01T00:00:00.000Z", wholeWord: true,
      caseSensitive: true, fuzzy: true,
    }]);
  });

  it("omits all-app scope and normalizes selected profiles", () => {
    expect(normalizeAppProfileIds(undefined)).toBeUndefined();
    expect(normalizeAppProfileIds([])).toBeUndefined();
    expect(normalizeAppProfileIds([" work ", "work", "mail"])).toEqual(["work", "mail"]);
  });

  it("preserves snippet matching metadata and emits an IPC-round-trippable all-app rule", () => {
    const snippets = [{ trigger: "sig", content: "Regards", matchBareTrigger: true, appProfileIds: ["mail"] }];
    const edited = editSnippet(snippets, "sig", { trigger: "signature", content: "Best regards", matchBareTrigger: false, appProfileIds: [] });

    expect(edited).toEqual([{ trigger: "signature", content: "Best regards", matchBareTrigger: false }]);
    expect(JSON.stringify(edited)).not.toContain("appProfileIds");
  });
});
