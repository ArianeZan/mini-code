import { execFile } from 'node:child_process';
import { lstat, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod';

import type { ChangeDiff } from '../../../ports/ChangeDiff.js';
import type { Tool } from '../../../ports/Tool.js';

const executeFile = promisify(execFile);
const MAX_DIFF_BYTES = 5_000_000;
const MAX_UNTRACKED_FILES = 1_000;
const MAX_UNTRACKED_ENTRIES = 4_000;

const GitDiffInputSchema = z.object({});
const GitDiffOutputSchema = z.object({ diff: z.string() });

type GitDiffInput = z.infer<typeof GitDiffInputSchema>;
type GitDiffOutput = z.infer<typeof GitDiffOutputSchema>;

export class GitDiffTool implements Tool<GitDiffInput, GitDiffOutput>, ChangeDiff {
  readonly name = 'git_diff';
  readonly description = 'Generate the repository diff, including untracked files.';
  readonly inputSchema = GitDiffInputSchema;
  readonly outputSchema = GitDiffOutputSchema;

  constructor(private readonly repositoryRoot: string) {}

  async execute(_input: GitDiffInput): Promise<GitDiffOutput> {
    return { diff: await this.generate() };
  }

  async validate(): Promise<void> {
    const result = await this.#git(['rev-parse', '--is-inside-work-tree']);
    if (result.trim() !== 'true') {
      throw new Error(`Repository is not a Git working tree: ${this.repositoryRoot}`);
    }
  }

  async generate(): Promise<string> {
    const base = await this.#resolveBaseTree();
    const tracked = await this.#git(['diff', '--no-ext-diff', base, '--', '.']);
    const status = await this.#git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
    const statusPaths = status
      .split('\0')
      .filter((entry) => entry.startsWith('?? '))
      .map((entry) => entry.slice(3));
    const untrackedPaths: string[] = [];
    const inspection = { entries: 0 };

    for (const statusPath of statusPaths) {
      const expandedPaths = await this.#expandUntrackedPath(statusPath, inspection);
      untrackedPaths.push(...expandedPaths);

      if (untrackedPaths.length > MAX_UNTRACKED_FILES) {
        throw new Error(`Git diff exceeded ${MAX_UNTRACKED_FILES} untracked files`);
      }
    }

    const untrackedDiffs: string[] = [];
    let totalBytes = Buffer.byteLength(tracked, 'utf8');

    for (const untrackedPath of untrackedPaths) {
      const untrackedDiff = await this.#git(
        ['diff', '--no-index', '--no-ext-diff', '--', '/dev/null', untrackedPath],
        true,
      );
      totalBytes += Buffer.byteLength(untrackedDiff, 'utf8');
      if (totalBytes > MAX_DIFF_BYTES) {
        throw new Error(`Git diff exceeded ${MAX_DIFF_BYTES} bytes`);
      }
      untrackedDiffs.push(untrackedDiff);
    }

    return [tracked, ...untrackedDiffs].filter((diff) => diff.length > 0).join('\n');
  }

  async #resolveBaseTree(): Promise<string> {
    try {
      await this.#git(['rev-parse', '--verify', 'HEAD']);
      return 'HEAD';
    } catch {
      return (await this.#git(['hash-object', '-t', 'tree', '/dev/null'])).trim();
    }
  }

  async #expandUntrackedPath(
    repositoryPath: string,
    inspection: { entries: number },
  ): Promise<string[]> {
    const absolutePath = path.resolve(this.repositoryRoot, repositoryPath);
    const relativePath = path.relative(this.repositoryRoot, absolutePath);

    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(`Git reported a path outside the repository: ${repositoryPath}`);
    }

    const resolvedPath = await realpath(absolutePath);
    const resolvedRelativePath = path.relative(this.repositoryRoot, resolvedPath);
    if (
      resolvedRelativePath === '..' ||
      resolvedRelativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(resolvedRelativePath)
    ) {
      throw new Error(`Git diff refuses path outside the repository: ${repositoryPath}`);
    }

    const pathStats = await lstat(absolutePath);
    if (pathStats.isSymbolicLink()) {
      throw new Error(`Git diff refuses untracked symbolic link: ${repositoryPath}`);
    }
    if (pathStats.isFile()) {
      return [repositoryPath];
    }

    if (!pathStats.isDirectory()) {
      return [];
    }

    const files: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      const entries = await opendir(directory);
      for await (const entry of entries) {
        inspection.entries += 1;
        if (inspection.entries > MAX_UNTRACKED_ENTRIES) {
          throw new Error(`Git diff exceeded ${MAX_UNTRACKED_ENTRIES} inspected entries`);
        }

        if (entry.name === '.git') {
          continue;
        }

        if (entry.isSymbolicLink()) {
          throw new Error(`Git diff refuses untracked symbolic link: ${repositoryPath}`);
        }

        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
        } else if (entry.isFile()) {
          files.push(path.relative(this.repositoryRoot, entryPath).split(path.sep).join('/'));
          if (files.length > MAX_UNTRACKED_FILES) {
            throw new Error(`Git diff exceeded ${MAX_UNTRACKED_FILES} untracked files`);
          }
        }
      }
    };

    await visit(absolutePath);
    return files;
  }

  async #git(arguments_: readonly string[], allowDiffExit = false): Promise<string> {
    try {
      const { stdout } = await executeFile('git', ['-C', this.repositoryRoot, ...arguments_], {
        encoding: 'utf8',
        maxBuffer: MAX_DIFF_BYTES,
        windowsHide: true,
      });
      return stdout;
    } catch (error) {
      if (
        allowDiffExit &&
        error instanceof Error &&
        'code' in error &&
        error.code === 1 &&
        'stdout' in error &&
        typeof error.stdout === 'string'
      ) {
        return error.stdout;
      }
      throw error;
    }
  }
}
