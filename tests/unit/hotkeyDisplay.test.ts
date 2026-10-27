import { describe, expect, it } from "vitest";
import { hotkeyDisplayParts } from "@renderer/lib/hotkeyDisplay";

describe("hotkeyDisplayParts", () => {
  it("maps modifiers to macOS glyphs and keeps the key name", () => {
    expect(hotkeyDisplayParts("Cmd+Shift+Space")).toEqual(["⌘", "⇧", "Space"]);
    expect(hotkeyDisplayParts("Ctrl+Option+D")).toEqual(["⌃", "⌥", "D"]);
  });

  it("shows the Fn key and ignores empty segments", () => {
    expect(hotkeyDisplayParts("Fn")).toEqual(["fn"]);
    expect(hotkeyDisplayParts("")).toEqual([]);
  });
});
