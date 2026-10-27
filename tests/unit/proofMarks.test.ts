import { describe, expect, it } from "vitest";
import { buildProof, summarizeProof } from "@renderer/lib/proofMarks";

const fillers = ["um", "uh", "you know"];

describe("buildProof", () => {
  it("marks deleted filler words as fillers, including multi-word fillers", () => {
    const tokens = buildProof("uh so you know the fix is ready", "So the fix is ready.", { fillers, corrections: [] });
    expect(tokens.filter((t) => t.kind === "filler").map((t) => t.text)).toEqual(["uh", "you know"]);
    expect(summarizeProof(tokens).fillers).toBe(2);
  });

  it("marks a replacement that matches an enabled dictionary rule as a dictionary fix", () => {
    const tokens = buildProof("pay with razor pay today", "Pay with Razorpay today.", {
      fillers,
      corrections: [{ spoken: "razor pay", written: "Razorpay", enabled: true }],
    });
    expect(tokens).toContainEqual({ kind: "fix", from: "razor pay", to: "Razorpay", dictionary: true });
    expect(summarizeProof(tokens).dictionaryFixes).toBe(1);
  });

  it("splits a 'scratch that' deletion into the scratched words and the spoken command", () => {
    const tokens = buildProof("ship it today scratch that ship it tomorrow", "Ship it tomorrow.", { fillers, corrections: [] });
    expect(tokens.find((t) => t.kind === "scratched")).toEqual({ kind: "scratched", text: "ship it today" });
    expect(tokens.find((t) => t.kind === "command")).toEqual({ kind: "command", text: "scratch that" });
  });

  it("returns the cleaned text unmarked when nothing but punctuation and case changed", () => {
    const tokens = buildProof("the fix is ready", "The fix is ready.", { fillers, corrections: [] });
    expect(tokens.every((t) => t.kind === "same")).toBe(true);
    expect(tokens.map((t) => (t.kind === "same" ? t.text : "")).join(" ")).toBe("The fix is ready.");
  });

  it("skips the diff for very long dictations and shows the cleaned text as is", () => {
    const raw = Array.from({ length: 1200 }, (_, i) => `w${i}`).join(" ");
    const cleaned = Array.from({ length: 1200 }, (_, i) => `x${i}`).join(" ");
    expect(buildProof(raw, cleaned, { fillers, corrections: [] })).toEqual([{ kind: "same", text: cleaned }]);
  });
});
