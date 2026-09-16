import { z } from 'zod';

import { RelevantFileSchema } from './RepositoryExploration.js';

const ExplorationActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('list_files'),
    path: z.string().min(1),
  }),
  z.object({
    action: z.literal('read_file'),
    path: z.string().min(1),
  }),
  z.object({
    action: z.literal('search_code'),
    path: z.string().min(1),
    query: z.string().trim().min(1).max(200),
  }),
  z.object({
    action: z.literal('complete'),
    relevantFiles: z.array(RelevantFileSchema),
    summary: z.string().min(1),
  }),
]);

export const ExplorationDecisionSchema = z.object({
  decision: ExplorationActionSchema,
});

export type ExplorationDecision = z.infer<typeof ExplorationActionSchema>;
