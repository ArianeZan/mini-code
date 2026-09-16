import { link, open, unlink } from 'node:fs/promises';
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

export class CreateFileTool implements Tool<FileMutationInput, FileMutationOutput> {
  readonly name = 'create_file';
  readonly description = 'Create one approved UTF-8 text file without overwriting an existing path.';
  readonly inputSchema = FileMutationInputSchema;
  readonly outputSchema = FileMutationOutputSchema;

  constructor(private readonly sandbox: RepositorySandbox) {}

  async execute(input: FileMutationInput): Promise<FileMutationOutput> {
    const target = await this.sandbox.resolveNewFile(input.path);
    const temporaryPath = path.join(
      path.dirname(target),
      `.${path.basename(target)}.mini-code-${randomUUID()}.tmp`,
    );
    const temporaryFile = await open(temporaryPath, 'wx', 0o666);

    try {
      await temporaryFile.writeFile(input.content, 'utf8');
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }

    try {
      await link(temporaryPath, target);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }

    return {
      path: this.sandbox.relative(target),
      bytesWritten: Buffer.byteLength(input.content, 'utf8'),
    };
  }
}
