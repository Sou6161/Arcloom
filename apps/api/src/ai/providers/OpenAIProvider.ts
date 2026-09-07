import OpenAI from 'openai';
import { AIProviderName } from '@decodr/types';
import type {
  AIProvider,
  CompletionRequest,
  CompletionResult,
} from '../types.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../utils/logger.js';

/**
 * Unwraps the nested `cause` chain a failed fetch produces. The OpenAI SDK's
 * APIConnectionError says only "Connection error."; the actual reason
 * (ENOTFOUND, ECONNRESET, a TLS or timeout code) is buried underneath.
 */
function describeCause(err: unknown, depth = 0): string {
  if (!(err instanceof Error) || depth > 4) return '';
  const code = (err as NodeJS.ErrnoException).code;
  const here = code ? `${code}: ${err.message}` : err.message;
  const deeper = describeCause((err as { cause?: unknown }).cause, depth + 1);
  return deeper ? `${here} <- ${deeper}` : here;
}

/** OpenAI implementation of the AIProvider abstraction. */
export class OpenAIProvider implements AIProvider {
  readonly name = AIProviderName.OpenAI;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseURL: string | undefined;
  private readonly headers: Record<string, string> | undefined;
  private readonly reasoning: boolean;
  private client: OpenAI | null = null;

  constructor(params: {
    apiKey: string;
    model: string;
    baseURL?: string;
    headers?: Record<string, string>;
    reasoning?: boolean;
  }) {
    this.apiKey = params.apiKey;
    this.model = params.model;
    this.baseURL = params.baseURL && params.baseURL.length > 0 ? params.baseURL : undefined;
    this.headers =
      params.headers && Object.keys(params.headers).length > 0 ? params.headers : undefined;
    this.reasoning = params.reasoning ?? false;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private getClient(): OpenAI {
    if (!this.isConfigured()) {
      throw new AppError(
        503,
        'AI_NOT_CONFIGURED',
        'OpenAI is not configured. Set OPENAI_API_KEY to enable explanations.',
      );
    }
    this.client ??= new OpenAI({
      apiKey: this.apiKey,
      ...(this.baseURL ? { baseURL: this.baseURL } : {}),
      ...(this.headers ? { defaultHeaders: this.headers } : {}),
    });
    return this.client;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const client = this.getClient();
    try {
      // `reasoning` is an OpenRouter extension not in the OpenAI SDK types, so
      // the body is assembled loosely and cast; the SDK forwards it verbatim.
      const body: Record<string, unknown> = {
        model: this.model,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 1024,
        messages: request.messages,
        ...(this.reasoning ? { reasoning: { enabled: true } } : {}),
      };

      const response = (await client.chat.completions.create(
        body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      )) as OpenAI.Chat.Completions.ChatCompletion;

      const message = response.choices[0]?.message;
      // Prefer the answer content; some reasoning models leave content empty and
      // put the text under `reasoning`, so fall back to that.
      let text = message?.content ?? '';
      if (!text && message) {
        const reasoning = (message as { reasoning?: unknown }).reasoning;
        if (typeof reasoning === 'string') text = reasoning;
      }
      return { text, model: response.model };
    } catch (err) {
      if (err instanceof OpenAI.APIError) {
        // Prefer the provider/gateway's own error message (e.g. "insufficient credits").
        const detail =
          (err.error as { message?: string } | undefined)?.message ?? err.message;
        // A connection failure carries no status; the reason is in the cause chain.
        const cause = err.status === undefined ? describeCause((err as { cause?: unknown }).cause) : '';
        logger.error(
          `AI request failed (${err.status ?? 'network'}) model=${this.model} ` +
            `baseURL=${this.baseURL ?? 'default'}: ${detail}${cause ? ` | cause: ${cause}` : ''}`,
        );
        throw new AppError(
          502,
          'AI_PROVIDER_ERROR',
          `AI request failed (${err.status ?? 'network'}): ${detail}${cause ? ` [${cause}]` : ''}`,
        );
      }
      const message = err instanceof Error ? err.message : 'Unknown AI error';
      throw new AppError(502, 'AI_PROVIDER_ERROR', `AI request failed: ${message}`);
    }
  }
}
