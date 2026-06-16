import type { ApiKeyValidationResult } from "./types";

const VALIDATION_TIMEOUT_MS = 5_000;

export function unavailableValidation(providerName: string): ApiKeyValidationResult {
  return {
    valid: false,
    message: `${providerName} cannot be validated without provider-specific connection settings.`,
  };
}

export async function validateBearerEndpoint(
  providerName: string,
  url: string,
  apiKey: string,
  authScheme: "Bearer" | "Token" | "x-api-key" = "Bearer",
  extraHeaders: Record<string, string> = {}
): Promise<ApiKeyValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { ...extraHeaders };
    if (authScheme === "x-api-key") {
      headers["x-api-key"] = apiKey;
    } else {
      headers.Authorization = `${authScheme} ${apiKey}`;
    }

    const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
    if (response.ok) {
      return { valid: true, message: `${providerName} API key is valid.` };
    }
    if (response.status === 401 || response.status === 403) {
      return { valid: false, message: `${providerName} rejected the API key.` };
    }
    return { valid: false, message: `${providerName} validation failed with status ${response.status}.` };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { valid: false, message: `${providerName} validation timed out.` };
    }
    return { valid: false, message: `${providerName} validation failed.` };
  } finally {
    clearTimeout(timeout);
  }
}
