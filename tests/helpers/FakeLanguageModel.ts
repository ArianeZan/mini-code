import type {
  LanguageModel,
  StructuredGenerationRequest,
} from '../../src/agent/ports/LanguageModel.js';

export interface RecordedGenerationRequest {
  readonly schemaName: string;
  readonly instructions: string;
  readonly input: string;
}

export class FakeLanguageModel implements LanguageModel {
  readonly requests: RecordedGenerationRequest[] = [];
  readonly #responses: unknown[];

  constructor(responses: readonly unknown[]) {
    this.#responses = [...responses];
  }

  async generate<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    this.requests.push({
      schemaName: request.schemaName,
      instructions: request.instructions,
      input: request.input,
    });

    if (this.#responses.length === 0) {
      throw new Error('FakeLanguageModel has no responses remaining');
    }

    return request.schema.parse(this.#responses.shift());
  }
}
