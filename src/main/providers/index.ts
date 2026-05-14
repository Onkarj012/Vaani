import { ProviderRegistry } from "./registry";
import { GroqSttProvider } from "./groq/groqStt";
import { GroqLlmProvider } from "./groq/groqLlm";
import { OpenAISttProvider, OpenAISttCompatibleProvider } from "./openai/openaiStt";
import { OpenAILlmProvider } from "./openai/openaiLlm";
import { DeepgramSttProvider } from "./deepgram/deepgramStt";
import { AnthropicLlmProvider } from "./anthropic/anthropicLlm";
import { OpenRouterLlmProvider } from "./anthropic/openRouterLlm";
import { LocalWhisperProvider } from "./local/whisperCpp";

let registry: ProviderRegistry | null = null;

export function getProviderRegistry(): ProviderRegistry {
  if (!registry) {
    registry = new ProviderRegistry();
    registry.registerTranscription(GroqSttProvider);
    registry.registerTranscription(OpenAISttProvider);
    registry.registerTranscription(OpenAISttCompatibleProvider);
    registry.registerTranscription(DeepgramSttProvider);
    registry.registerTranscription(LocalWhisperProvider);
    registry.registerFormatting(GroqLlmProvider);
    registry.registerFormatting(OpenAILlmProvider);
    registry.registerFormatting(AnthropicLlmProvider);
    registry.registerFormatting(OpenRouterLlmProvider);
  }
  return registry;
}

export { ProviderRegistry } from "./registry";
export type { TranscriptionProvider, FormattingProvider } from "./types";
