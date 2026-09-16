import { z } from 'zod';

export const TaskExecutionProposalSchema = z.object({
  taskId: z.string().min(1),
  changes: z
    .array(
      z.object({
        path: z.string().min(1),
        operation: z.enum(['create', 'modify']),
        content: z.string().max(1_000_000),
      }),
    )
    .min(1),
});

export type TaskExecutionProposal = z.infer<typeof TaskExecutionProposalSchema>;
