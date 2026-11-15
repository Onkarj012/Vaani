import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import OpenRouterKeyPrompt from "@renderer/components/OpenRouterKeyPrompt";
import { providerKeySaved } from "@renderer/lib/providerKeyDraft";

// Renders the prompt to HTML so tests can check its form and accessibility attributes.
function render(): string {
  return renderToStaticMarkup(createElement(OpenRouterKeyPrompt, { updateSettings: async () => {} }));
}

describe("OpenRouterKeyPrompt", () => {
  it("is a form so Enter in the key field saves", () => {
    const html = render();
    expect(html).toMatch(/^<form[^>]*role="dialog"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save key<\/button>/);
  });

  it("keeps Later from submitting the form", () => {
    expect(render()).toMatch(/<button[^>]*type="button"[^>]*>Later<\/button>/);
  });

  it("gives the key field a spoken label", () => {
    expect(render()).toMatch(/<input[^>]*type="password"[^>]*aria-label="OpenRouter API key"/);
  });
});

describe("providerKeySaved", () => {
  it("is true only when the provider has a stored key", () => {
    expect(providerKeySaved([{ providerId: "openrouter", key: "", hasKey: true }], "openrouter")).toBe(true);
    expect(providerKeySaved([{ providerId: "openrouter", key: "", hasKey: false }], "openrouter")).toBe(false);
    expect(providerKeySaved([{ providerId: "groq", key: "", hasKey: true }], "openrouter")).toBe(false);
    expect(providerKeySaved(undefined, "openrouter")).toBe(false);
  });
});
