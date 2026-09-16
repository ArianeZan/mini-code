import { open } from 'node:fs/promises';

import {
  SearchCodeInputSchema,
  SearchCodeOutputSchema,
  type SearchCodeInput,
  type SearchCodeOutput,
} from '../../../ports/RepositoryTools.js';
import type { Tool } from '../../../ports/Tool.js';
import type { RepositorySandbox } from '../filesystem/RepositorySandbox.js';
import { walkRepository } from '../filesystem/walkRepository.js';

const MAX_FILE_BYTES = 64_000;

export class SearchCodeTool implements Tool<SearchCodeInput, SearchCodeOutput> {
  readonly name = 'search_code';
  readonly description = 'Search text files for a case-insensitive literal string.';
  readonly inputSchema = SearchCodeInputSchema;
  readonly outputSchema = SearchCodeOutputSchema;

  constructor(
    private readonly sandbox: RepositorySandbox,
    private readonly maxMatches = 50,
    private readonly maxFiles = 300,
  ) {}

  async execute(input: SearchCodeInput): Promise<SearchCodeOutput> {
    const walked = await walkRepository(this.sandbox, input.path, {
      maxDepth: 8,
      maxEntries: this.maxFiles,
    });
    const query = input.query.toLowerCase();
    const matches: SearchCodeOutput['matches'] = [];
    let contentTruncated = false;

    for (const entry of walked.entries) {
      if (entry.type !== 'file') {
        continue;
      }

      const file = await readSearchablePrefix(entry.absolutePath);
      if (file === undefined) {
        continue;
      }
      contentTruncated ||= file.truncated;

      const lines = file.content.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (!line.toLowerCase().includes(query)) {
          continue;
        }

        matches.push({
          path: entry.path,
          line: index + 1,
          text: line.slice(0, 300),
        });

        if (matches.length >= this.maxMatches) {
          return { matches, truncated: true };
        }
      }
    }

    return { matches, truncated: walked.truncated || contentTruncated };
  }
}

async function readSearchablePrefix(
  filePath: string,
): Promise<{ content: string; truncated: boolean } | undefined> {
  let file: Awaited<ReturnType<typeof open>> | undefined;

  try {
    file = await open(filePath, 'r');
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const content = buffer.subarray(0, Math.min(bytesRead, MAX_FILE_BYTES));

    return content.includes(0)
      ? undefined
      : { content: content.toString('utf8'), truncated: bytesRead > MAX_FILE_BYTES };
  } catch {
    return undefined;
  } finally {
    await file?.close();
  }
}
