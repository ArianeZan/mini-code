import { zodTextFormat } from 'openai/helpers/zod';
import { describe, expect, it } from 'vitest';

import { VerificationCorrectionSchema } from '../../../src/agent/domain/VerificationCorrection.js';

describe('VerificationCorrectionSchema', () => {
  it('produces an object root compatible with OpenAI structured outputs', () => {
    const format = zodTextFormat(VerificationCorrectionSchema, 'verification_correction');

    expect(format).toMatchObject({
      type: 'json_schema',
      strict: true,
      schema: { type: 'object' },
    });
  });
});
