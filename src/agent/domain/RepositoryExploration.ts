import { z } from 'zod';

export const RelevantFileSchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
});

export const RepositoryExplorationSchema = z.object({
  relevantFiles: z.array(RelevantFileSchema),
  summary: z.string().min(1),
});

export type RepositoryExploration = z.infer<typeof RepositoryExplorationSchema>;
