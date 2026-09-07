import { AIProviderName } from '@decodr/types';
import { env, primaryOrigin } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { AIProvider } from './types.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';

/**
 * Resolves the active AI provider from configuration. Only OpenAI is wired in
 * the MVP; the remaining cases are explicit extension points so the intended
 * shape of the abstraction is obvious.
 */
export function createAIProvider(): AIProvider {
  switch (env.AI_PROVIDER) {
    case AIProviderName.OpenAI:
      return new OpenAIProvider({
        apiKey: env.OPENAI_API_KEY,
        model: env.AI_MODEL,
        baseURL: env.OPENAI_BASE_URL,
        // OpenRouter attribution headers (harmless/ignored by other providers).
        headers: {
          'HTTP-Referer': primaryOrigin,
          'X-Title': env.AI_SITE_NAME,
        },
        reasoning: env.AI_REASONING,
      });
    case AIProviderName.Claude:
    case AIProviderName.Gemini:
    case AIProviderName.Ollama:
      throw new Error(
        `AI provider "${env.AI_PROVIDER}" is not implemented yet. ` +
          `Add a provider class implementing AIProvider and a branch here.`,
      );
    default: {
      const _exhaustive: never = env.AI_PROVIDER;
      throw new Error(`Unknown AI provider: ${String(_exhaustive)}`);
    }
  }
}

/** Lazily-constructed singleton provider. */
let provider: AIProvider | null = null;
export function getAIProvider(): AIProvider {
  if (!provider) {
    provider = createAIProvider();
    logger.info(
      `AI provider initialized: ${provider.name} (${provider.model}), configured=${provider.isConfigured()}`,
    );
  }
  return provider;
}
