import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  isRestrictedEnvironmentFile,
  isRestrictedRepositoryName,
} from '../../../domain/RepositoryPathPolicy.js';
import type { RepositoryPathInspector } from '../../../ports/RepositoryPathInspector.js';

export class RepositorySandbox implements RepositoryPathInspector {
  private constructor(readonly root: string) {}

  static async create(repositoryRoot: string): Promise<RepositorySandbox> {
    const root = await realpath(repositoryRoot);
    const rootStats = await stat(root);

    if (!rootStats.isDirectory()) {
      throw new Error(`Repository root is not a directory: ${repositoryRoot}`);
    }

    return new RepositorySandbox(root);
  }

  async resolveExisting(repositoryPath: string): Promise<string> {
    const segments = this.#validateRequestedPath(repositoryPath);
    const candidate = path.resolve(this.root, ...segments);
    const resolved = await realpath(candidate);

    if (!this.contains(resolved)) {
      throw new Error(`Path resolves outside the repository: ${repositoryPath}`);
    }

    const resolvedSegments = path.relative(this.root, resolved).split(path.sep);
    this.#assertAllowed(resolvedSegments);

    return resolved;
  }

  async exists(repositoryPath: string): Promise<boolean> {
    const segments = this.#validateRequestedPath(repositoryPath);
    const candidate = path.resolve(this.root, ...segments);

    if (!this.contains(candidate)) {
      throw new Error(`Path resolves outside the repository: ${repositoryPath}`);
    }

    let resolved;
    try {
      resolved = await realpath(candidate);
    } catch (error) {
      if (isMissingPathError(error)) {
        await this.#assertNearestExistingAncestorIsSafe(candidate, repositoryPath);
        return false;
      }
      throw error;
    }

    if (!this.contains(resolved)) {
      throw new Error(`Path resolves outside the repository: ${repositoryPath}`);
    }

    this.#assertAllowed(path.relative(this.root, resolved).split(path.sep));
    return true;
  }

  contains(absolutePath: string): boolean {
    const relativePath = path.relative(this.root, absolutePath);
    return (
      relativePath === '' ||
      (!relativePath.startsWith(`..${path.sep}`) &&
        relativePath !== '..' &&
        !path.isAbsolute(relativePath))
    );
  }

  relative(absolutePath: string): string {
    if (!this.contains(absolutePath)) {
      throw new Error(`Path is outside the repository: ${absolutePath}`);
    }

    const relativePath = path.relative(this.root, absolutePath);
    return relativePath === '' ? '.' : relativePath.split(path.sep).join('/');
  }

  #assertAllowed(segments: readonly string[]): void {
    for (const segment of segments) {
      const normalizedSegment = segment.toLowerCase();

      if (isRestrictedRepositoryName(normalizedSegment)) {
        throw new Error(`Path is restricted: ${segments.join('/')}`);
      }

      if (isRestrictedEnvironmentFile(normalizedSegment)) {
        throw new Error(`Environment files are restricted: ${segments.join('/')}`);
      }
    }
  }

  #validateRequestedPath(repositoryPath: string): string[] {
    const segments = repositoryPath.split(/[\\/]+/);

    if (
      repositoryPath.trim() === '' ||
      path.posix.isAbsolute(repositoryPath) ||
      path.win32.isAbsolute(repositoryPath) ||
      segments.includes('..') ||
      segments.some((segment) => segment.includes(':'))
    ) {
      throw new Error(`Path must stay inside the repository: ${repositoryPath}`);
    }

    this.#assertAllowed(segments);
    return segments;
  }

  async #assertNearestExistingAncestorIsSafe(
    candidate: string,
    repositoryPath: string,
  ): Promise<void> {
    let currentPath = candidate;

    while (this.contains(currentPath)) {
      try {
        const resolved = await realpath(currentPath);

        if (!this.contains(resolved)) {
          throw new Error(`Path resolves outside the repository: ${repositoryPath}`);
        }

        this.#assertAllowed(path.relative(this.root, resolved).split(path.sep));
        const resolvedStats = await stat(resolved);
        if (!resolvedStats.isDirectory()) {
          throw new Error(`Parent path is not a directory: ${repositoryPath}`);
        }
        return;
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }

        try {
          const entry = await lstat(currentPath);
          if (entry.isSymbolicLink()) {
            throw new Error(`Path contains an unresolved symbolic link: ${repositoryPath}`);
          }
        } catch (entryError) {
          if (!isMissingPathError(entryError)) {
            throw entryError;
          }
        }

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {
          break;
        }
        currentPath = parentPath;
      }
    }

    throw new Error(`Path resolves outside the repository: ${repositoryPath}`);
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}
