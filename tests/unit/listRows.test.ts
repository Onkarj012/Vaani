import { describe, expect, it } from "vitest";
import { historyTimeLabel, hasSnippetScopeConflict, matchesDictionaryFilter, matchesSnippetQuery, proofSummaryText } from "@renderer/lib/listRows";
import type { ProofSummary } from "@renderer/lib/proofMarks";

describe("list row helpers", () => {
  it("formats history time labels for today, yesterday, and older dates", () => {
    const now = new Date(2026, 10, 7, 20, 0);
    expect(historyTimeLabel(new Date(2026, 10, 7, 19, 31).toISOString(), now)).toBe("7:31 PM");
    expect(historyTimeLabel(new Date(2026, 10, 6, 19, 31).toISOString(), now)).toBe("Yesterday, 7:31 PM");
    expect(historyTimeLabel(new Date(2026, 10, 3, 19, 31).toISOString(), now)).toBe("3 Nov, 7:31 PM");
  });

  it("summarizes proof changes and omits unchanged text", () => {
    const summary: ProofSummary = { fillers: 2, dictionaryFixes: 1, rewrites: 0, scratched: 0, changed: true };
    expect(proofSummaryText(summary)).toBe("2 fillers, 1 fix");
    expect(proofSummaryText({ ...summary, fillers: 0, dictionaryFixes: 0 })).toBe("");
  });

  it("filters dictionary rules by source, enabled state, and text", () => {
    const autoRule = { spoken: "gonna", written: "going to", source: "auto-suggested", enabled: true };
    expect(matchesDictionaryFilter(autoRule, "auto", "going")).toBe(true);
    expect(matchesDictionaryFilter(autoRule, "manual", "")).toBe(false);
    expect(matchesDictionaryFilter({ ...autoRule, enabled: false }, "disabled", "gonna")).toBe(true);
    expect(matchesDictionaryFilter({ ...autoRule, enabled: false }, "auto", "")).toBe(false);
  });

  it("searches snippets by trigger and body", () => {
    const snippet = { trigger: "sig", content: "Best regards" };
    expect(matchesSnippetQuery(snippet, "best")).toBe(true);
    expect(matchesSnippetQuery(snippet, "unknown")).toBe(false);
  });

  it("detects duplicate snippet triggers only when app scopes overlap", () => {
    const snippets = [
      { trigger: "sig", content: "A", appProfileIds: ["work"] },
      { trigger: "sig", content: "B", appProfileIds: ["personal"] },
    ];
    expect(hasSnippetScopeConflict(snippets, "SIG", ["work"])).toBe(true);
    expect(hasSnippetScopeConflict(snippets, "sig", ["other"])).toBe(false);
    expect(hasSnippetScopeConflict(snippets, "sig", undefined)).toBe(true);
    expect(hasSnippetScopeConflict(snippets, "sig", ["work", "personal"], 0)).toBe(true);
    expect(hasSnippetScopeConflict(snippets, "sig", ["work"], 0)).toBe(false);
  });
});
