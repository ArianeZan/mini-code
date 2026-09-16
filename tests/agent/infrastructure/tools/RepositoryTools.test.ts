import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SearchCodeTool } from '../../../../src/agent/infrastructure/tools/code/SearchCodeTool.js';
import { ListFilesTool } from '../../../../src/agent/infrastructure/tools/filesystem/ListFilesTool.js';
import { ReadFileTool } from '../../../../src/agent/infrastructure/tools/filesystem/ReadFileTool.js';
import { RepositorySandbox } from '../../../../src/agent/infrastructure/tools/filesystem/RepositorySandbox.js';

describe('repository exploration tools', () => {
  let repositoryRoot: string;
  let sandbox: RepositorySandbox;

  beforeEach(async () => {
    repositoryRoot = await mkdtemp(path.join(tmpdir(), 'mini-code-tools-'));
    await mkdir(path.join(repositoryRoot, 'src'));
    await mkdir(path.join(repositoryRoot, 'node_modules'));
    await mkdir(path.join(repositoryRoot, '.GiT'));
    await writeFile(
      path.join(repositoryRoot, 'src', 'RegisterUser.ts'),
      ['export function registerUser(email: string) {', '  return { email }', '}'].join('\n'),
    );
    await writeFile(path.join(repositoryRoot, 'src', 'binary.dat'), Buffer.from([0, 1, 2]));
    await writeFile(path.join(repositoryRoot, 'node_modules', 'hidden.ts'), 'registerUser');
    await writeFile(path.join(repositoryRoot, '.GiT', 'config'), 'token=secret');
    await writeFile(path.join(repositoryRoot, '.env'), 'OPENAI_API_KEY=secret');
    await writeFile(path.join(repositoryRoot, '.env.example'), 'OPENAI_API_KEY=');
    await writeFile(path.join(repositoryRoot, '.npmrc'), '//registry.npmjs.org/:_authToken=secret');
    sandbox = await RepositorySandbox.create(repositoryRoot);
  });

  afterEach(async () => {
    await rm(repositoryRoot, { recursive: true, force: true });
  });

  it('lists repository files while excluding dependencies and environment secrets', async () => {
    const tool = new ListFilesTool(sandbox);

    const result = await tool.execute({ path: '.' });

    expect(result.entries).toEqual(
      expect.arrayContaining([
        { path: '.env.example', type: 'file' },
        { path: 'src', type: 'directory' },
        { path: 'src/RegisterUser.ts', type: 'file' },
      ]),
    );
    expect(result.entries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '.env' }),
        expect.objectContaining({ path: 'node_modules' }),
        expect.objectContaining({ path: '.GiT' }),
        expect.objectContaining({ path: '.npmrc' }),
      ]),
    );
  });

  it('reads text files with an explicit byte limit', async () => {
    const tool = new ReadFileTool(sandbox, 10);

    const result = await tool.execute({ path: 'src/RegisterUser.ts' });

    expect(result).toEqual({
      path: 'src/RegisterUser.ts',
      content: 'export fun',
      truncated: true,
    });
  });

  it('reports whether safe repository paths exist', async () => {
    await expect(sandbox.exists('src/RegisterUser.ts')).resolves.toBe(true);
    await expect(sandbox.exists('src/NewUser.ts')).resolves.toBe(false);
    await expect(sandbox.exists('src/RegisterUser.ts/NewUser.ts')).rejects.toThrow(
      'Parent path is not a directory',
    );
    await expect(sandbox.exists('../outside.ts')).rejects.toThrow(
      'Path must stay inside the repository',
    );
  });

  it('rejects traversal, restricted files, and binary content', async () => {
    const tool = new ReadFileTool(sandbox);

    await expect(tool.execute({ path: '../outside.ts' })).rejects.toThrow(
      'Path must stay inside the repository',
    );
    await expect(tool.execute({ path: '.env' })).rejects.toThrow(
      'Environment files are restricted',
    );
    await expect(tool.execute({ path: '.ENV' })).rejects.toThrow(
      'Environment files are restricted',
    );
    await expect(tool.execute({ path: '.env:secret' })).rejects.toThrow(
      'Path must stay inside the repository',
    );
    await expect(tool.execute({ path: '.GiT/config' })).rejects.toThrow('Path is restricted');
    await expect(tool.execute({ path: '.npmrc' })).rejects.toThrow('Path is restricted');
    await expect(tool.execute({ path: 'src/binary.dat' })).rejects.toThrow(
      'Binary files cannot be read',
    );
  });

  it('searches code case-insensitively and reports line numbers', async () => {
    const tool = new SearchCodeTool(sandbox);

    const result = await tool.execute({ path: '.', query: 'REGISTERUSER' });

    expect(result).toEqual({
      matches: [
        {
          path: 'src/RegisterUser.ts',
          line: 1,
          text: 'export function registerUser(email: string) {',
        },
      ],
      truncated: false,
    });
  });

  it('prevents search outside the repository', async () => {
    const tool = new SearchCodeTool(sandbox);

    await expect(tool.execute({ path: '..', query: 'secret' })).rejects.toThrow(
      'Path must stay inside the repository',
    );
  });

  it('rejects symlinks that resolve outside the repository', async () => {
    const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'mini-code-outside-'));

    try {
      await writeFile(path.join(outsideDirectory, 'secret.ts'), 'secret');
      await symlink(outsideDirectory, path.join(repositoryRoot, 'linked'), 'junction');
      const tool = new ReadFileTool(sandbox);

      await expect(tool.execute({ path: 'linked/secret.ts' })).rejects.toThrow(
        'Path resolves outside the repository',
      );
      await expect(sandbox.exists('linked/new.ts')).rejects.toThrow(
        'Path resolves outside the repository',
      );
    } finally {
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });
});
