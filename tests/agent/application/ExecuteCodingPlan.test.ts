import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ExecuteCodingPlan } from '../../../src/agent/application/ExecuteCodingPlan.js';
import { ToolRegistry } from '../../../src/agent/application/ToolRegistry.js';
import type { CodingPlan } from '../../../src/agent/domain/CodingPlan.js';
import { CreateFileTool } from '../../../src/agent/infrastructure/tools/filesystem/CreateFileTool.js';
import { EditFileTool } from '../../../src/agent/infrastructure/tools/filesystem/EditFileTool.js';
import { ReadFileTool } from '../../../src/agent/infrastructure/tools/filesystem/ReadFileTool.js';
import { RepositorySandbox } from '../../../src/agent/infrastructure/tools/filesystem/RepositorySandbox.js';
import { FakeLanguageModel } from '../../helpers/FakeLanguageModel.js';

describe('ExecuteCodingPlan', () => {
  let repositoryRoot: string;
  let tools: ToolRegistry;

  beforeEach(async () => {
    repositoryRoot = await mkdtemp(path.join(tmpdir(), 'mini-code-execute-'));
    await mkdir(path.join(repositoryRoot, 'src'));
    await writeFile(path.join(repositoryRoot, 'src', 'RegisterUser.ts'), 'export const step = 0\n');
    await writeFile(path.join(repositoryRoot, 'src', 'Existing.ts'), 'existing\n');
    const sandbox = await RepositorySandbox.create(repositoryRoot);
    tools = new ToolRegistry();
    tools.register(new ReadFileTool(sandbox, 1_000_000));
    tools.register(new CreateFileTool(sandbox));
    tools.register(new EditFileTool(sandbox));
  });

  afterEach(async () => {
    await rm(repositoryRoot, { recursive: true, force: true });
  });

  it('executes tasks sequentially using the latest file content', async () => {
    const model = new FakeLanguageModel([
      {
        taskId: 'task-1',
        changes: [
          { path: 'src/RegisterUser.ts', operation: 'modify', content: 'export const step = 1\n' },
        ],
      },
      {
        taskId: 'task-2',
        changes: [
          { path: 'src/RegisterUser.ts', operation: 'modify', content: 'export const step = 2\n' },
        ],
      },
    ]);
    const plan = planWithTasks([
      modifyTask('task-1', 'Apply the first change.'),
      modifyTask('task-2', 'Apply the second change.'),
    ]);

    const result = await new ExecuteCodingPlan(model, tools).execute('Change registration', plan);

    expect(result).toEqual({
      success: true,
      completedTaskIds: ['task-1', 'task-2'],
      failedTaskIds: [],
      modifiedFiles: ['src/RegisterUser.ts'],
    });
    expect(model.requests[1]?.input).toContain('export const step = 1');
    await expect(
      readFile(path.join(repositoryRoot, 'src', 'RegisterUser.ts'), 'utf8'),
    ).resolves.toBe('export const step = 2\n');
  });

  it('rejects files outside the approved task before writing', async () => {
    const model = new FakeLanguageModel([
      {
        taskId: 'task-1',
        changes: [
          { path: 'src/Unapproved.ts', operation: 'create', content: 'unapproved\n' },
        ],
      },
    ]);
    const plan = planWithTasks([modifyTask('task-1', 'Modify registration.')]);

    const result = await new ExecuteCodingPlan(model, tools).execute('Change registration', plan);

    expect(result).toMatchObject({
      success: false,
      completedTaskIds: [],
      failedTaskIds: ['task-1'],
      modifiedFiles: [],
      failureReason: 'Execution proposal contains an unapproved file: src/Unapproved.ts',
    });
    await expect(
      readFile(path.join(repositoryRoot, 'src', 'RegisterUser.ts'), 'utf8'),
    ).resolves.toBe('export const step = 0\n');
  });

  it('tracks files written before a later write in the task fails', async () => {
    const model = new FakeLanguageModel([
      {
        taskId: 'task-1',
        changes: [
          { path: 'src/New.ts', operation: 'create', content: 'new\n' },
          { path: 'src/Existing.ts', operation: 'create', content: 'overwrite\n' },
        ],
      },
    ]);
    const plan = planWithTasks([
      {
        id: 'task-1',
        description: 'Create two files.',
        files: [
          { path: 'src/New.ts', operation: 'create', reason: 'Add a new file.' },
          { path: 'src/Existing.ts', operation: 'create', reason: 'Exercise failure tracking.' },
        ],
        verification: { expectedOutcome: 'Files exist.' },
      },
    ]);

    const result = await new ExecuteCodingPlan(model, tools).execute('Create files', plan);

    expect(result).toMatchObject({
      success: false,
      completedTaskIds: [],
      failedTaskIds: ['task-1'],
      modifiedFiles: ['src/New.ts'],
      failureReason: 'File already exists: src/Existing.ts',
    });
    await expect(readFile(path.join(repositoryRoot, 'src', 'New.ts'), 'utf8')).resolves.toBe(
      'new\n',
    );
  });
});

function modifyTask(id: string, description: string): CodingPlan['tasks'][number] {
  return {
    id,
    description,
    files: [
      {
        path: 'src/RegisterUser.ts',
        operation: 'modify',
        reason: 'Implement registration behavior.',
      },
    ],
    verification: { expectedOutcome: 'Registration behavior changes.' },
  };
}

function planWithTasks(tasks: CodingPlan['tasks']): CodingPlan {
  return {
    goal: 'Change registration',
    tasks,
    verificationStrategy: 'Run registration tests.',
  };
}
