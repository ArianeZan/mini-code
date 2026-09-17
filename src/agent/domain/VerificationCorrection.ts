import { z } from 'zod';

export const VerificationCorrectionSchema = z.object({
  analysis: z.string().min(1).max(10_000),
  changes: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string().max(1_000_000),
      }),
    )
    .min(1)
    .max(20),
});

export type VerificationCorrection = z.infer<typeof VerificationCorrectionSchema>;

export interface VerificationCorrectionRecord {
  readonly attempt: number;
  readonly analysis: string;
  readonly modifiedFiles: string[];
}
