import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const RESTRICTED_NAMES = new Set([
  '.aws',
  '.git',
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.ssh',
  '.venv',
  'coverage',
  'dist',
  'node_modules',
  'vendor',
  'venv',
]);

export class RepositorySandbox {
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

    const candidate = path.resolve(this.root, ...segments);
    const resolved = await realpath(candidate);

    if (!this.contains(resolved)) {
      throw new Error(`Path resolves outside the repository: ${repositoryPath}`);
    }

    const resolvedSegments = path.relative(this.root, resolved).split(path.sep);
    this.#assertAllowed(resolvedSegments);

    return resolved;
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
}

export function isRestrictedRepositoryName(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return (
    RESTRICTED_NAMES.has(normalizedName) ||
    normalizedName === 'id_rsa' ||
    normalizedName === 'id_ed25519' ||
    normalizedName.endsWith('.key') ||
    normalizedName.endsWith('.pem')
  );
}

export function isRestrictedEnvironmentFile(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return (
    normalizedName === '.env' ||
    (normalizedName.startsWith('.env.') && normalizedName !== '.env.example')
  );
}
