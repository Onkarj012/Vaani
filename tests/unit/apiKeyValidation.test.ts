import { describe, expect, it, vi } from "vitest";
import type { FormattingProvider } from "@main/providers/types";
import { validateSubmittedApiKey } from "@main/providers/apiKeyValidation";

function provider(overrides: Partial<FormattingProvider> = {}): FormattingProvider {
  return {
    id: "fake",
    name: "Fake Provider",
    requiresApiKey: true,
    models: [],
    format: vi.fn(),
    isAvailable: vi.fn(),
    validateApiKey: vi.fn(async () => ({ valid: true, message: "valid" })),
    ...overrides,
  };
}

describe("validateSubmittedApiKey", () => {
  it("rejects empty keys without calling the provider", async () => {
    const validateApiKey = vi.fn();
    const result = await validateSubmittedApiKey("fake", "   ", () => provider({ validateApiKey }));

    expect(result.valid).toBe(false);
    expect(validateApiKey).not.toHaveBeenCalled();
  });

  it("passes the exact trimmed submitted key to provider validation", async () => {
    const validateApiKey = vi.fn(async () => ({ valid: true, message: "valid" }));
    const result = await validateSubmittedApiKey("fake", "  submitted-key  ", () => provider({ validateApiKey }));

    expect(result.valid).toBe(true);
    expect(validateApiKey).toHaveBeenCalledWith("submitted-key");
  });

  it("returns invalid when the provider is unknown", async () => {
    const result = await validateSubmittedApiKey("missing", "key", () => undefined);

    expect(result).toEqual({ valid: false, message: 'Provider "missing" not found.' });
  });

  it("converts provider validation errors to a generic invalid response", async () => {
    const result = await validateSubmittedApiKey("fake", "key", () => provider({
      validateApiKey: vi.fn(async () => {
        throw new Error("secret-adjacent details");
      }),
    }));

    expect(result).toEqual({ valid: false, message: "API key test failed." });
  });
});
