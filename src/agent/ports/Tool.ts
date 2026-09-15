import type { z } from 'zod';

export interface Tool<TInput, TOutput> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;

  execute(input: TInput): Promise<TOutput>;
}

export type ToolErrorCode =
  | 'unknown-tool'
  | 'invalid-input'
  | 'invalid-output'
  | 'execution-failed';

export type ToolResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: ToolErrorCode;
        readonly message: string;
        readonly details?: unknown;
      };
    };
