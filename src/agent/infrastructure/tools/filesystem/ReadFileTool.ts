import { open, stat } from 'node:fs/promises';

import {
  ReadFileInputSchema,
  ReadFileOutputSchema,
  type ReadFileInput,
  type ReadFileOutput,
} from '../../../ports/RepositoryTools.js';
import type { Tool } from '../../../ports/Tool.js';
import type { RepositorySandbox } from './RepositorySandbox.js';

export class ReadFileTool implements Tool<ReadFileInput, ReadFileOutput> {
  readonly name = 'read_file';
  readonly description = 'Read a UTF-8 text file using a repository-relative path.';
  readonly inputSchema = ReadFileInputSchema;
  readonly outputSchema = ReadFileOutputSchema;

  constructor(
    private readonly sandbox: RepositorySandbox,
    private readonly maxBytes = 20_000,
  ) {}

  async execute(input: ReadFileInput): Promise<ReadFileOutput> {
    const absolutePath = await this.sandbox.resolveExisting(input.path);
    const fileStats = await stat(absolutePath);

    if (!fileStats.isFile()) {
      throw new Error(`Path is not a file: ${input.path}`);
    }

    const file = await open(absolutePath, 'r');

    try {
      const buffer = Buffer.alloc(this.maxBytes + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const readableBytes = buffer.subarray(0, Math.min(bytesRead, this.maxBytes));

      if (readableBytes.includes(0)) {
        throw new Error(`Binary files cannot be read: ${input.path}`);
      }

      return {
        path: this.sandbox.relative(absolutePath),
        content: readableBytes.toString('utf8'),
        truncated: bytesRead > this.maxBytes,
      };
    } finally {
      await file.close();
    }
  }
}
