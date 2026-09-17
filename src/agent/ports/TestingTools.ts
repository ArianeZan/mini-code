import { z } from 'zod';

import type { VerificationResult } from '../domain/VerificationResult.js';

export {
  VerificationResultSchema,
  type VerificationResult,
} from '../domain/VerificationResult.js';

export const RunTestsInputSchema = z.object({}).strict();

export type RunTestsInput = z.infer<typeof RunTestsInputSchema>;

export interface TestRunner {
  run(): Promise<VerificationResult>;
}
