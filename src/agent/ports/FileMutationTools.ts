import { z } from 'zod';

export const FileMutationInputSchema = z.object({
  path: z.string().min(1),
  content: z.string().max(1_000_000),
});

export const FileMutationOutputSchema = z.object({
  path: z.string(),
  bytesWritten: z.number().int().nonnegative(),
});

export type FileMutationInput = z.infer<typeof FileMutationInputSchema>;
export type FileMutationOutput = z.infer<typeof FileMutationOutputSchema>;
