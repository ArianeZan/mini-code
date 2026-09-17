import { z } from 'zod';

export const VerificationResultSchema = z.object({
  passed: z.boolean(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
  outputTruncated: z.boolean(),
  durationMs: z.number().int().nonnegative(),
});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;
