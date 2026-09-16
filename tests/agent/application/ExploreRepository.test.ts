import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ExploreRepository } from '../../../src/agent/application/ExploreRepository.js';
import { ToolRegistry } from '../../../src/agent/application/ToolRegistry.js';
import { SearchCodeTool } from '../../../src/agent/infrastructure/tools/code/SearchCodeTool.js';
import { ListFilesTool } from '../../../src/agent/infrastructure/tools/filesystem/ListFilesTool.js';
import { ReadFileTool } from '../../../src/agent/infrastructure/tools/filesystem/ReadFileTool.js';
import { RepositorySandbox } from '../../../src/agent/infrastructure/tools/filesystem/RepositorySandbox.js';
import { FakeLanguageModel } from '../../helpers/FakeLanguageModel.js';

describe('ExploreRepository', () => {
  let repositoryRoot: string;
  let tools: ToolRegistry;

  beforeEach(async () => {
    repositoryRoot = await mkdtemp(path.join(tmpdir(), 'mini-code-explore-'));
    await mkdir(path.join(repositoryRoot, 'src'));
    await writeFile(
      path.join(repositoryRoot, 'src', 'RegisterUser.ts'),
      'export function registerUser(email: string) { return { email } }',
    );

    const sandbox = await RepositorySandbox.create(repositoryRoot);
    tools = new ToolRegistry();
    tools.register(new ListFilesTool(sandbox));
    tools.register(new ReadFileTool(sandbox));
    tools.register(new SearchCodeTool(sandbox));
  });

  afterEach(async () => {
    await rm(repositoryRoot, { recursive: true, force: true });
  });

  it('executes one structured decision at a time until exploration completes', async () => {
    const model = new FakeLanguageModel([
      {
        decision: { action: 'list_files', path: '.' },
      },
      {
        decision: { action: 'read_file', path: 'src/RegisterUser.ts' },
      },
      {
        decision: {
          action: 'complete',
          relevantFiles: [
            {
              path: 'src/RegisterUser.ts',
              reason: 'Contains the registration behavior.',
            },
          ],
          summary: 'Registration is implemented in one source file.',
        },
      },
    ]);

    const result = await new ExploreRepository(model, tools).execute('Validate registration email');

    expect(result).toEqual({
      relevantFiles: [
        { path: 'src/RegisterUser.ts', reason: 'Contains the registration behavior.' },
      ],
      summary: 'Registration is implemented in one source file.',
    });
    expect(model.requests).toHaveLength(3);
    expect(model.requests[1]?.input).toContain('src/RegisterUser.ts');
    expect(model.requests[2]?.input).toContain('export function registerUser');
  });

  it('rejects relevant paths that were not discovered', async () => {
    const model = new FakeLanguageModel([
      {
        decision: {
          action: 'complete',
          relevantFiles: [{ path: 'src/Invented.ts', reason: 'Invented path.' }],
          summary: 'Premature result.',
        },
      },
      {
        decision: { action: 'list_files', path: '.' },
      },
      {
        decision: {
          action: 'complete',
          relevantFiles: [
            {
              path:
                process.platform === 'win32'
                  ? './SRC/registeruser.TS'
                  : './src/RegisterUser.ts',
              reason: 'Observed registration implementation.',
            },
          ],
          summary: 'Observed result.',
        },
      },
    ]);

    const result = await new ExploreRepository(model, tools).execute('Find registration');

    expect(result.relevantFiles[0]?.path).toBe('src/RegisterUser.ts');
    expect(model.requests[1]?.input).toContain('completion_rejected');
    expect(model.requests[1]?.input).toContain('src/Invented.ts');
  });

  it('stops when the exploration step limit is reached', async () => {
    const model = new FakeLanguageModel([
      { decision: { action: 'list_files', path: '.' } },
      { decision: { action: 'list_files', path: '.' } },
    ]);

    await expect(
      new ExploreRepository(model, tools, 2).execute('Never complete'),
    ).rejects.toThrow('Repository exploration exceeded 2 steps');
  });

  it('requires a finite positive integer step limit', () => {
    const model = new FakeLanguageModel([]);

    expect(() => new ExploreRepository(model, tools, Number.POSITIVE_INFINITY)).toThrow(
      'Exploration steps must be a positive safe integer',
    );
    expect(() => new ExploreRepository(model, tools, Number.NaN)).toThrow(
      'Exploration steps must be a positive safe integer',
    );
  });
});
