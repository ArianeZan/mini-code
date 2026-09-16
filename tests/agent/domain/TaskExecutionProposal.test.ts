import { zodTextFormat } from 'openai/helpers/zod';
import { describe, expect, it } from 'vitest';

import { TaskExecutionProposalSchema } from '../../../src/agent/domain/TaskExecutionProposal.js';

describe('TaskExecutionProposalSchema', () => {
  it('produces an object root compatible with OpenAI structured outputs', () => {
    const format = zodTextFormat(TaskExecutionProposalSchema, 'task_execution_proposal');

    expect(format).toMatchObject({
      type: 'json_schema',
      strict: true,
      schema: { type: 'object' },
    });
  });
});
