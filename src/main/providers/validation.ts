import type { ApiKeyValidationResult } from "./types";

const VALIDATION_TIMEOUT_MS = 5_000;

export function unavailableValidation(providerName: string): ApiKeyValidationResult {
  return {
    valid: false,
    message: `${providerName} cannot be validated without provider-specific connection settings.`,
  };
}

/** Message for a key check that got no answer before the timeout. */
function timeoutMessage(providerName: string): string {
  return `${providerName} didn't answer within ${VALIDATION_TIMEOUT_MS / 1000} seconds. Check your internet connection and try again.`;
}

/** Turns a non-OK key-check status into a message that says whether the key or the service is at fault. */
function statusFailureMessage(providerName: string, status: number): string {
  if (status === 401 || status === 403) {
    return `${providerName} rejected the API key. Check that you pasted the whole key.`;
  }
  if (status === 429) {
    return `${providerName} is limiting requests right now. Your key may be fine. Try again in a minute.`;
  }
  if (status >= 500) {
    return `${providerName} is having trouble right now (status ${status}). Your key may be fine. Try again later.`;
  }
  return `${providerName} validation failed with status ${status}.`;
}

export async function validateBearerEndpoint(
  providerName: string,
  url: string,
  apiKey: string,
  authScheme: "Bearer" | "Token" | "x-api-key" = "Bearer",
  extraHeaders: Record<string, string> = {},
  inspectOkReply?: (response: Response) => Promise<ApiKeyValidationResult | null>
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

    let response: Response;
    try {
      response = await fetch(url, { method: "GET", headers, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { valid: false, message: timeoutMessage(providerName) };
      }
      return { valid: false, message: `Couldn't reach ${providerName}. Check your internet connection and try again.` };
    }
    if (!response.ok) {
      return { valid: false, message: statusFailureMessage(providerName, response.status) };
    }
    const verdict = inspectOkReply ? await inspectOkReply(response) : null;
    return verdict ?? { valid: true, message: `${providerName} API key is valid.` };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { valid: false, message: timeoutMessage(providerName) };
    }
    return { valid: false, message: `${providerName} validation failed.` };
  } finally {
    clearTimeout(timeout);
  }
}
