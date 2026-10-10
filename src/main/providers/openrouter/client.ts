import { createCancellationScope } from "@main/cancellation";
import type { ApiKeyValidationResult } from "../types";
import { validateBearerEndpoint } from "../validation";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_ATTRIBUTION_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://vaani.app",
  "X-Title": "Vaani",
};

const OPENROUTER_TIMEOUT_MS = 20_000;

export interface OpenRouterPostRequest {
  /** Path under OPENROUTER_BASE_URL, starting with "/". */
  path: string;
  apiKey: string;
  /** A JSON string or FormData. Set Content-Type in headers for JSON bodies only. */
  body: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

// POSTs to OpenRouter and returns the parsed JSON reply. The timeout also covers reading the body.
export async function openRouterPostJson<T>(request: OpenRouterPostRequest): Promise<T> {
  const scope = createCancellationScope(request.signal, Date.now() + (request.timeoutMs ?? OPENROUTER_TIMEOUT_MS));
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}${request.path}`, {
      method: "POST",
      headers: { ...OPENROUTER_ATTRIBUTION_HEADERS, ...request.headers, Authorization: `Bearer ${request.apiKey}` },
      body: request.body,
      signal: scope.signal,
    });
    if (!response.ok) throw new Error(`OpenRouter API request failed with status ${response.status}.`);
    return await response.json() as T;
  } catch (error) {
    // A caller cancel keeps its own error so the formatter rethrows it.
    if (request.signal?.aborted) throw error;
    if (scope.signal.aborted) throw new Error("Request timed out.");
    throw error;
  } finally {
    scope.dispose();
  }
}

// Checks a key against OpenRouter's models endpoint. Both OpenRouter adapters use it.
export function validateOpenRouterKey(apiKey: string): Promise<ApiKeyValidationResult> {
  return validateBearerEndpoint("OpenRouter", `${OPENROUTER_BASE_URL}/models`, apiKey, "Bearer", OPENROUTER_ATTRIBUTION_HEADERS);
}
