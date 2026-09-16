import { z } from 'zod';

export const CodingFileChangeSchema = z.object({
  path: z.string().min(1),
  operation: z.enum(['create', 'modify']),
  reason: z.string().min(1),
});

export const CodingTaskSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  files: z.array(CodingFileChangeSchema).min(1),
  verification: z.object({
    expectedOutcome: z.string().min(1),
  }),
});

export const CodingPlanSchema = z.object({
  goal: z.string().min(1),
  tasks: z.array(CodingTaskSchema).min(1),
  verificationStrategy: z.string().min(1),
});

export type CodingFileChange = z.infer<typeof CodingFileChangeSchema>;
export type CodingTask = z.infer<typeof CodingTaskSchema>;
export type CodingPlan = z.infer<typeof CodingPlanSchema>;
