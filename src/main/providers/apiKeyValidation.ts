import type { FormattingProvider, TranscriptionProvider } from "./types";

export async function validateSubmittedApiKey(
  providerId: string,
  apiKey: string,
  lookupProvider: (providerId: string) => TranscriptionProvider | FormattingProvider | undefined
): Promise<{ valid: boolean; message: string }> {
  try {
    const submittedKey = apiKey.trim();
    if (!submittedKey) return { valid: false, message: "Enter an API key to test." };

    const provider = lookupProvider(providerId);
    if (!provider) return { valid: false, message: `Provider "${providerId}" not found.` };
    if (!provider.requiresApiKey) return { valid: true, message: `${provider.name} does not require an API key.` };
    if (!provider.validateApiKey) return { valid: false, message: `${provider.name} does not support API key validation.` };

    return await provider.validateApiKey(submittedKey);
  } catch {
    return { valid: false, message: "API key test failed." };
  }
}
