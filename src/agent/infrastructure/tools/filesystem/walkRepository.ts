import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  isRestrictedEnvironmentFile,
  isRestrictedRepositoryName,
  type RepositorySandbox,
} from './RepositorySandbox.js';

export interface RepositoryEntry {
  readonly absolutePath: string;
  readonly path: string;
  readonly type: 'file' | 'directory';
}

export interface WalkRepositoryResult {
  readonly entries: RepositoryEntry[];
  readonly truncated: boolean;
}

export async function walkRepository(
  sandbox: RepositorySandbox,
  startPath: string,
  options: { readonly maxDepth: number; readonly maxEntries: number },
): Promise<WalkRepositoryResult> {
  const start = await sandbox.resolveExisting(startPath);
  const startStats = await stat(start);

  if (!startStats.isDirectory()) {
    throw new Error(`Path is not a directory: ${startPath}`);
  }

  const entries: RepositoryEntry[] = [];
  let truncated = false;
  let stopped = false;
  let scannedEntries = 0;

  async function visit(directory: string, depth: number): Promise<void> {
    if (stopped || depth > options.maxDepth) {
      return;
    }

    let directoryEntries;

    try {
      directoryEntries = await opendir(directory);
    } catch (error) {
      if (depth === 1) {
        throw error;
      }

      truncated = true;
      return;
    }

    for await (const entry of directoryEntries) {
      scannedEntries += 1;
      if (scannedEntries > options.maxEntries * 4) {
        truncated = true;
        stopped = true;
        return;
      }

      const normalizedName = entry.name.toLowerCase();
      if (
        isRestrictedRepositoryName(normalizedName) ||
        isRestrictedEnvironmentFile(normalizedName)
      ) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (!entry.isDirectory() && !entry.isFile()) {
        continue;
      }

      if (entries.length >= options.maxEntries) {
        truncated = true;
        stopped = true;
        return;
      }

      const absolutePath = path.join(directory, entry.name);
      entries.push({
        absolutePath,
        path: sandbox.relative(absolutePath),
        type: entry.isDirectory() ? 'directory' : 'file',
      });

      if (entry.isDirectory() && depth < options.maxDepth) {
        await visit(absolutePath, depth + 1);
      } else if (entry.isDirectory()) {
        truncated = true;
      }
    }
  }

  await visit(start, 1);
  return { entries, truncated };
}
