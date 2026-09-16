import {
  ListFilesInputSchema,
  ListFilesOutputSchema,
  type ListFilesInput,
  type ListFilesOutput,
} from '../../../ports/RepositoryTools.js';
import type { Tool } from '../../../ports/Tool.js';
import type { RepositorySandbox } from './RepositorySandbox.js';
import { walkRepository } from './walkRepository.js';

export class ListFilesTool implements Tool<ListFilesInput, ListFilesOutput> {
  readonly name = 'list_files';
  readonly description = 'List repository files recursively from a relative directory path.';
  readonly inputSchema = ListFilesInputSchema;
  readonly outputSchema = ListFilesOutputSchema;

  constructor(
    private readonly sandbox: RepositorySandbox,
    private readonly maxEntries = 200,
    private readonly maxDepth = 5,
  ) {}

  async execute(input: ListFilesInput): Promise<ListFilesOutput> {
    const result = await walkRepository(this.sandbox, input.path, {
      maxEntries: this.maxEntries,
      maxDepth: this.maxDepth,
    });

    return {
      entries: result.entries.map(({ path, type }) => ({ path, type })),
      truncated: result.truncated,
    };
  }
}
