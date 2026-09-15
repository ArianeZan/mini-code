import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { FakeLanguageModel } from './FakeLanguageModel.js';

const AnswerSchema = z.object({ answer: z.string() });

describe('FakeLanguageModel', () => {
  it('returns queued responses in order and records requests', async () => {
    const model = new FakeLanguageModel([{ answer: 'first' }, { answer: 'second' }]);
    const request = {
      schemaName: 'answer',
      schema: AnswerSchema,
      instructions: 'Return an answer.',
      input: 'Question',
    };

    await expect(model.generate(request)).resolves.toEqual({ answer: 'first' });
    await expect(model.generate(request)).resolves.toEqual({ answer: 'second' });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]).toEqual({
      schemaName: 'answer',
      instructions: 'Return an answer.',
      input: 'Question',
    });
  });

  it('validates fake responses against the requested schema', async () => {
    const model = new FakeLanguageModel([{ answer: 42 }]);

    await expect(
      model.generate({
        schemaName: 'answer',
        schema: AnswerSchema,
        instructions: 'Return an answer.',
        input: 'Question',
      }),
    ).rejects.toThrow();
  });

  it('fails clearly when no queued response remains', async () => {
    const model = new FakeLanguageModel([]);

    await expect(
      model.generate({
        schemaName: 'answer',
        schema: AnswerSchema,
        instructions: 'Return an answer.',
        input: 'Question',
      }),
    ).rejects.toThrow('FakeLanguageModel has no responses remaining');
  });
});
