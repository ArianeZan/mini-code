import type { z } from 'zod';

export interface StructuredGenerationRequest<T> {
  readonly schemaName: string;
  readonly schema: z.ZodType<T>;
  readonly instructions: string;
  readonly input: string;
}

export interface LanguageModel {
  generate<T>(request: StructuredGenerationRequest<T>): Promise<T>;
}
