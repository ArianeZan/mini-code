import { chmod, open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  FileMutationInputSchema,
  FileMutationOutputSchema,
  type FileMutationInput,
  type FileMutationOutput,
} from '../../../ports/FileMutationTools.js';
import type { Tool } from '../../../ports/Tool.js';
import type { RepositorySandbox } from './RepositorySandbox.js';

export class EditFileTool implements Tool<FileMutationInput, FileMutationOutput> {
  readonly name = 'edit_file';
  readonly description = 'Atomically replace one approved UTF-8 text file with complete content.';
  readonly inputSchema = FileMutationInputSchema;
  readonly outputSchema = FileMutationOutputSchema;

  constructor(private readonly sandbox: RepositorySandbox) {}

  async execute(input: FileMutationInput): Promise<FileMutationOutput> {
    const target = await this.sandbox.resolveExisting(input.path);
    const targetStats = await stat(target);

    if (!targetStats.isFile()) {
      throw new Error(`Path is not a file: ${input.path}`);
    }

    const temporaryPath = path.join(
      path.dirname(target),
      `.${path.basename(target)}.mini-code-${randomUUID()}.tmp`,
    );
    const temporaryFile = await open(temporaryPath, 'wx', targetStats.mode);

    try {
      await temporaryFile.writeFile(input.content, 'utf8');
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }

    try {
      await chmod(temporaryPath, targetStats.mode);
      await rename(temporaryPath, target);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }

    return {
      path: this.sandbox.relative(target),
      bytesWritten: Buffer.byteLength(input.content, 'utf8'),
    };
  }
}
