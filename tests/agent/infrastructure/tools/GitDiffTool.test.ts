import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { GitDiffTool } from '../../../../src/agent/infrastructure/tools/git/GitDiffTool.js';

const executeFile = promisify(execFile);

describe('GitDiffTool', () => {
  const temporaryPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.splice(0).map((temporaryPath) =>
        rm(temporaryPath, { recursive: true, force: true }),
      ),
    );
  });

  it('includes tracked modifications and untracked files', async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'mini-code-diff-'));
    temporaryPaths.push(repositoryRoot);
    await executeFile('git', ['init'], { cwd: repositoryRoot });
    await writeFile(path.join(repositoryRoot, 'tracked.txt'), 'old\n');
    await executeFile('git', ['add', 'tracked.txt'], { cwd: repositoryRoot });
    await executeFile(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'],
      { cwd: repositoryRoot },
    );
    await writeFile(path.join(repositoryRoot, 'tracked.txt'), 'new\n');
    await executeFile('git', ['add', 'tracked.txt'], { cwd: repositoryRoot });
    await writeFile(path.join(repositoryRoot, 'created.txt'), 'created\n');
    const nestedRepository = path.join(repositoryRoot, 'nested');
    await mkdir(nestedRepository);
    await executeFile('git', ['init'], { cwd: nestedRepository });
    await writeFile(path.join(nestedRepository, 'nested.txt'), 'nested\n');

    const tool = new GitDiffTool(repositoryRoot);
    await expect(tool.validate()).resolves.toBeUndefined();
    const diff = await tool.generate();

    expect(diff).toContain('-old');
    expect(diff).toContain('+new');
    expect(diff).toContain('created.txt');
    expect(diff).toContain('+created');
    expect(diff).toContain('nested/nested.txt');
    expect(diff).toContain('+nested');
  });

  it('rejects directories that are not inside a Git working tree', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mini-code-no-git-'));
    temporaryPaths.push(directory);

    await expect(new GitDiffTool(directory).validate()).rejects.toThrow();
  });

  it('refuses untracked symbolic links', async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'mini-code-diff-link-'));
    const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'mini-code-diff-outside-'));
    temporaryPaths.push(repositoryRoot, outsideDirectory);
    await executeFile('git', ['init'], { cwd: repositoryRoot });
    const nestedRepository = path.join(repositoryRoot, 'nested');
    await mkdir(nestedRepository);
    await executeFile('git', ['init'], { cwd: nestedRepository });
    await writeFile(path.join(outsideDirectory, 'secret.txt'), 'secret\n');
    await symlink(outsideDirectory, path.join(nestedRepository, 'linked'), 'junction');

    await expect(new GitDiffTool(repositoryRoot).generate()).rejects.toThrow(
      'Git diff refuses untracked symbolic link',
    );
  });
});
