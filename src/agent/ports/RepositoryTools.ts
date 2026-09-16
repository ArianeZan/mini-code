import { z } from 'zod';

export const ListFilesInputSchema = z.object({
  path: z.string().min(1),
});

export const ListFilesOutputSchema = z.object({
  entries: z.array(
    z.object({
      path: z.string(),
      type: z.enum(['file', 'directory']),
    }),
  ),
  truncated: z.boolean(),
});

export const ReadFileInputSchema = z.object({
  path: z.string().min(1),
});

export const ReadFileOutputSchema = z.object({
  path: z.string(),
  content: z.string(),
  truncated: z.boolean(),
});

export const SearchCodeInputSchema = z.object({
  path: z.string().min(1),
  query: z.string().trim().min(1).max(200),
});

export const SearchCodeOutputSchema = z.object({
  matches: z.array(
    z.object({
      path: z.string(),
      line: z.number().int().positive(),
      text: z.string(),
    }),
  ),
  truncated: z.boolean(),
});

export type ListFilesInput = z.infer<typeof ListFilesInputSchema>;
export type ListFilesOutput = z.infer<typeof ListFilesOutputSchema>;
export type ReadFileInput = z.infer<typeof ReadFileInputSchema>;
export type ReadFileOutput = z.infer<typeof ReadFileOutputSchema>;
export type SearchCodeInput = z.infer<typeof SearchCodeInputSchema>;
export type SearchCodeOutput = z.infer<typeof SearchCodeOutputSchema>;
