import { zodTextFormat } from 'openai/helpers/zod';
import { describe, expect, it } from 'vitest';

import { CodingPlanSchema } from '../../../src/agent/domain/CodingPlan.js';

describe('CodingPlanSchema', () => {
  it('produces an object root compatible with OpenAI structured outputs', () => {
    const format = zodTextFormat(CodingPlanSchema, 'coding_plan');

    expect(format).toMatchObject({
      type: 'json_schema',
      strict: true,
      schema: { type: 'object' },
    });
  });
});
