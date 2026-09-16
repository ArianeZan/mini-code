import { describe, expect, it } from 'vitest';

import { CreateCodingPlan } from '../../../src/agent/application/CreateCodingPlan.js';
import type { RepositoryExploration } from '../../../src/agent/domain/RepositoryExploration.js';
import type { RepositoryPathInspector } from '../../../src/agent/ports/RepositoryPathInspector.js';
import { FakeLanguageModel } from '../../helpers/FakeLanguageModel.js';

const exploration: RepositoryExploration = {
  relevantFiles: [
    {
      path: 'src/users/RegisterUser.ts',
      reason: 'Contains the registration workflow.',
    },
  ],
  summary: 'Registration is handled by RegisterUser.',
};

function createPlanResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    goal: 'Model-rewritten goal',
    tasks: [
      {
        id: 'task-1',
        description: 'Add email validation to registration.',
        files: [
          {
            path: './src/users/RegisterUser.ts',
            operation: 'modify',
            reason: 'Apply validation before registration.',
          },
          {
            path: 'src/users/Email.ts',
            operation: 'create',
            reason: 'Represent validated email addresses.',
          },
        ],
        verification: {
          expectedOutcome: 'Invalid emails are rejected.',
        },
      },
    ],
    verificationStrategy: 'Run registration unit tests.',
    ...overrides,
  };
}

function createPathInspector(
  existingPaths: readonly string[] = ['src/users/RegisterUser.ts'],
): RepositoryPathInspector {
  const paths = new Set(
    existingPaths.map((filePath) =>
      process.platform === 'win32' ? filePath.toLowerCase() : filePath,
    ),
  );

  return {
    async exists(repositoryPath: string): Promise<boolean> {
      const pathKey = process.platform === 'win32' ? repositoryPath.toLowerCase() : repositoryPath;
      return paths.has(pathKey);
    },
  };
}

describe('CreateCodingPlan', () => {
  it('creates an ordered plan constrained by repository exploration', async () => {
    const model = new FakeLanguageModel([createPlanResponse()]);

    const plan = await new CreateCodingPlan(model, createPathInspector()).execute(
      'Prevent registration with invalid email addresses',
      exploration,
    );

    expect(plan).toEqual({
      goal: 'Prevent registration with invalid email addresses',
      tasks: [
        {
          id: 'task-1',
          description: 'Add email validation to registration.',
          files: [
            {
              path: 'src/users/RegisterUser.ts',
              operation: 'modify',
              reason: 'Apply validation before registration.',
            },
            {
              path: 'src/users/Email.ts',
              operation: 'create',
              reason: 'Represent validated email addresses.',
            },
          ],
          verification: { expectedOutcome: 'Invalid emails are rejected.' },
        },
      ],
      verificationStrategy: 'Run registration unit tests.',
    });
    expect(model.requests[0]?.input).toContain('src/users/RegisterUser.ts');
  });

  it('rejects modifications to files not identified during exploration', async () => {
    const model = new FakeLanguageModel([
      createPlanResponse({
        tasks: [
          {
            id: 'task-1',
            description: 'Modify an unknown file.',
            files: [
              {
                path: 'src/users/Unknown.ts',
                operation: 'modify',
                reason: 'Assumed dependency.',
              },
            ],
            verification: { expectedOutcome: 'Unknown behavior changes.' },
          },
        ],
      }),
    ]);

    await expect(
      new CreateCodingPlan(model, createPathInspector()).execute('Change registration', exploration),
    ).rejects.toThrow(
      'Plan cannot modify an unexplored file: src/users/Unknown.ts',
    );
  });

  it('rejects duplicate task IDs', async () => {
    const task = {
      id: 'task-1',
      description: 'Modify registration.',
      files: [
        {
          path: 'src/users/RegisterUser.ts',
          operation: 'modify',
          reason: 'Apply registration behavior.',
        },
      ],
      verification: { expectedOutcome: 'Registration changes.' },
    };
    const model = new FakeLanguageModel([
      createPlanResponse({ tasks: [task, { ...task, description: 'Repeat registration change.' }] }),
    ]);

    await expect(
      new CreateCodingPlan(model, createPathInspector()).execute('Change registration', exploration),
    ).rejects.toThrow(
      'Coding plan contains duplicate task ID: task-1',
    );
  });

  it('rejects new files outside the repository', async () => {
    const model = new FakeLanguageModel([
      createPlanResponse({
        tasks: [
          {
            id: 'task-1',
            description: 'Create an unsafe file.',
            files: [
              {
                path: '../Email.ts',
                operation: 'create',
                reason: 'Unsafe location.',
              },
            ],
            verification: { expectedOutcome: 'File exists.' },
          },
        ],
      }),
    ]);

    await expect(
      new CreateCodingPlan(model, createPathInspector()).execute('Change registration', exploration),
    ).rejects.toThrow(
      'Plan contains an invalid repository path: ../Email.ts',
    );
  });

  it('rejects planned changes to restricted repository paths', async () => {
    const model = new FakeLanguageModel([
      createPlanResponse({
        tasks: [
          {
            id: 'task-1',
            description: 'Create an environment file.',
            files: [
              {
                path: '.env.local',
                operation: 'create',
                reason: 'Store configuration.',
              },
            ],
            verification: { expectedOutcome: 'Configuration exists.' },
          },
        ],
      }),
    ]);

    await expect(
      new CreateCodingPlan(model, createPathInspector()).execute(
        'Configure registration',
        exploration,
      ),
    ).rejects.toThrow(
      'Plan contains a restricted repository path: .env.local',
    );
  });

  it('rejects creation when an unexplored target already exists', async () => {
    const model = new FakeLanguageModel([
      createPlanResponse({
        tasks: [
          {
            id: 'task-1',
            description: 'Create an existing helper.',
            files: [
              {
                path: 'src/users/ExistingHelper.ts',
                operation: 'create',
                reason: 'Add a helper.',
              },
            ],
            verification: { expectedOutcome: 'Helper exists.' },
          },
        ],
      }),
    ]);
    const repositoryPaths = createPathInspector([
      'src/users/RegisterUser.ts',
      'src/users/ExistingHelper.ts',
    ]);

    await expect(
      new CreateCodingPlan(model, repositoryPaths).execute('Change registration', exploration),
    ).rejects.toThrow('Plan cannot create an existing file: src/users/ExistingHelper.ts');
  });

  it('rejects Windows device names on every platform', async () => {
    const model = new FakeLanguageModel([
      createPlanResponse({
        tasks: [
          {
            id: 'task-1',
            description: 'Create an invalid file.',
            files: [
              {
                path: 'src/users/CON.ts',
                operation: 'create',
                reason: 'Invalid portable name.',
              },
            ],
            verification: { expectedOutcome: 'File exists.' },
          },
        ],
      }),
    ]);

    await expect(
      new CreateCodingPlan(model, createPathInspector()).execute('Change registration', exploration),
    ).rejects.toThrow('Plan contains an invalid repository path: src/users/CON.ts');
  });

  it('rejects duplicate creations across tasks', async () => {
    const createFile = {
      path: 'src/users/Email.ts',
      operation: 'create',
      reason: 'Represent validated email addresses.',
    };
    const model = new FakeLanguageModel([
      createPlanResponse({
        tasks: [
          {
            id: 'task-1',
            description: 'Create the email value.',
            files: [createFile],
            verification: { expectedOutcome: 'Email value exists.' },
          },
          {
            id: 'task-2',
            description: 'Create the email value again.',
            files: [{ ...createFile, path: 'src/users/email.ts' }],
            verification: { expectedOutcome: 'Email value still exists.' },
          },
        ],
      }),
    ]);

    await expect(
      new CreateCodingPlan(model, createPathInspector()).execute('Change registration', exploration),
    ).rejects.toThrow('Plan cannot create the same file twice: src/users/email.ts');
  });

  it('rejects explored paths that collide on case-insensitive filesystems', async () => {
    const model = new FakeLanguageModel([createPlanResponse()]);
    const ambiguousExploration: RepositoryExploration = {
      ...exploration,
      relevantFiles: [
        ...exploration.relevantFiles,
        {
          path: 'src/users/registeruser.ts',
          reason: 'Collides by casing with the registration workflow.',
        },
      ],
    };

    await expect(
      new CreateCodingPlan(model, createPathInspector()).execute(
        'Change registration',
        ambiguousExploration,
      ),
    ).rejects.toThrow(
      'Exploration contains non-portable path casing: src/users/RegisterUser.ts, src/users/registeruser.ts',
    );
  });
});
