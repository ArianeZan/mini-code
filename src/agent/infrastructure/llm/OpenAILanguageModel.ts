import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';

import type {
  LanguageModel,
  StructuredGenerationRequest,
} from '../../ports/LanguageModel.js';

export interface OpenAILanguageModelOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly client?: OpenAI;
}

export class OpenAILanguageModel implements LanguageModel {
  readonly #client: OpenAI;
  readonly #model: string;

  constructor(options: OpenAILanguageModelOptions = {}) {
    if (options.client) {
      this.#client = options.client;
      this.#model = options.model ?? process.env['OPENAI_MODEL'] ?? 'gpt-5.6';
      return;
    }

    const apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }

    this.#client = new OpenAI({ apiKey });
    this.#model = options.model ?? process.env['OPENAI_MODEL'] ?? 'gpt-5.6';
  }

  async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    const response = await this.#client.responses.parse({
      model: this.#model,
      input: [
        { role: 'system', content: request.instructions },
        { role: 'user', content: request.input },
      ],
      text: {
        format: zodTextFormat(request.schema, request.schemaName),
      },
    });

    if (response.output_parsed === null) {
      throw new Error(`Model returned no structured output for ${request.schemaName}`);
    }

    return request.schema.parse(response.output_parsed);
  }
}
