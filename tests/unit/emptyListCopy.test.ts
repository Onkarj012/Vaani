import { describe, expect, it } from "vitest";
import { emptyListCopy } from "@renderer/lib/emptyListCopy";

const snippet = { singular: "snippet", plural: "snippets" };

describe("emptyListCopy", () => {
  it("asks for a first item when the list is empty", () => {
    expect(emptyListCopy(snippet, "", 0)).toEqual({
      title: "No snippets yet",
      body: "Create your first snippet to get started.",
      canClearSearch: false,
    });
  });

  it("still asks for a first item when a search runs over an empty list", () => {
    expect(emptyListCopy(snippet, "sig", 0).canClearSearch).toBe(false);
  });

  it("names the search and the item count when a search finds nothing", () => {
    expect(emptyListCopy(snippet, "  sgi ", 3)).toEqual({
      title: "No snippets match “sgi”",
      body: "You have 3 snippets. Check the spelling or clear the search.",
      canClearSearch: true,
    });
  });

  it("uses the singular noun for one item", () => {
    expect(emptyListCopy({ singular: "rule", plural: "rules" }, "x", 1).body).toBe(
      "You have 1 rule. Check the spelling or clear the search.",
    );
  });
});
