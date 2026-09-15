import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { OpenAILanguageModel } from '../../../../src/agent/infrastructure/llm/OpenAILanguageModel.js';

const AnswerSchema = z.object({ answer: z.string() });

function createClient(outputParsed: unknown): { client: OpenAI; parse: ReturnType<typeof vi.fn> } {
  const parse = vi.fn().mockResolvedValue({ output_parsed: outputParsed });
  const client = { responses: { parse } } as unknown as OpenAI;

  return { client, parse };
}

describe('OpenAILanguageModel', () => {
  it('maps a structured request to the Responses API and validates its result', async () => {
    const { client, parse } = createClient({ answer: 'validated' });
    const model = new OpenAILanguageModel({ client, model: 'test-model' });

    await expect(
      model.generate({
        schemaName: 'answer',
        schema: AnswerSchema,
        instructions: 'Return one answer.',
        input: 'Question',
      }),
    ).resolves.toEqual({ answer: 'validated' });

    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        input: [
          { role: 'system', content: 'Return one answer.' },
          { role: 'user', content: 'Question' },
        ],
      }),
    );
  });

  it('fails clearly when the model returns no parsed output', async () => {
    const { client } = createClient(null);
    const model = new OpenAILanguageModel({ client });

    await expect(
      model.generate({
        schemaName: 'answer',
        schema: AnswerSchema,
        instructions: 'Return one answer.',
        input: 'Question',
      }),
    ).rejects.toThrow('Model returned no structured output for answer');
  });
});
