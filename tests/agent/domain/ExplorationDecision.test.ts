import { zodTextFormat } from 'openai/helpers/zod';
import { describe, expect, it } from 'vitest';

import { ExplorationDecisionSchema } from '../../../src/agent/domain/ExplorationDecision.js';

describe('ExplorationDecisionSchema', () => {
  it('produces an object root compatible with OpenAI structured outputs', () => {
    const format = zodTextFormat(ExplorationDecisionSchema, 'exploration_decision');

    expect(format).toMatchObject({
      type: 'json_schema',
      strict: true,
      schema: { type: 'object' },
    });
  });
});
