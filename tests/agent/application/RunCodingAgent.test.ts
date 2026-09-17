import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CreateCodingPlan } from '../../../src/agent/application/CreateCodingPlan.js';
import { ExecuteCodingPlan } from '../../../src/agent/application/ExecuteCodingPlan.js';
import { ExploreRepository } from '../../../src/agent/application/ExploreRepository.js';
import { RunCodingAgent } from '../../../src/agent/application/RunCodingAgent.js';
import { ToolRegistry } from '../../../src/agent/application/ToolRegistry.js';
import { VerifyChanges } from '../../../src/agent/application/VerifyChanges.js';
import { SearchCodeTool } from '../../../src/agent/infrastructure/tools/code/SearchCodeTool.js';
import { CreateFileTool } from '../../../src/agent/infrastructure/tools/filesystem/CreateFileTool.js';
import { EditFileTool } from '../../../src/agent/infrastructure/tools/filesystem/EditFileTool.js';
import { ListFilesTool } from '../../../src/agent/infrastructure/tools/filesystem/ListFilesTool.js';
import { ReadFileTool } from '../../../src/agent/infrastructure/tools/filesystem/ReadFileTool.js';
import { RepositorySandbox } from '../../../src/agent/infrastructure/tools/filesystem/RepositorySandbox.js';
import type { PlanApproval } from '../../../src/agent/ports/PlanApproval.js';
import type {
  TestRunner,
  VerificationResult,
} from '../../../src/agent/ports/TestingTools.js';
import { FakeLanguageModel } from '../../helpers/FakeLanguageModel.js';

describe('RunCodingAgent', () => {
  let repositoryRoot: string;
  let sandbox: RepositorySandbox;
  let tools: ToolRegistry;

  beforeEach(async () => {
    repositoryRoot = await mkdtemp(path.join(tmpdir(), 'mini-code-agent-'));
    await mkdir(path.join(repositoryRoot, 'src'));
    await writeFile(
      path.join(repositoryRoot, 'src', 'RegisterUser.ts'),
      'export const validate = false\n',
    );
    sandbox = await RepositorySandbox.create(repositoryRoot);
    tools = new ToolRegistry();
    tools.register(new ListFilesTool(sandbox));
    tools.register(new ReadFileTool(sandbox, 1_000_000));
    tools.register(new SearchCodeTool(sandbox));
    tools.register(new CreateFileTool(sandbox));
    tools.register(new EditFileTool(sandbox));
  });

  afterEach(async () => {
    await rm(repositoryRoot, { recursive: true, force: true });
  });

  it('cancels cleanly when the user rejects the plan', async () => {
    const model = new FakeLanguageModel([...explorationResponses(), codingPlanResponse()]);
    const agent = createAgent(model, { requestApproval: async () => false });

    const state = await agent.execute('Validate registration email', repositoryRoot);

    expect(state.status).toBe('cancelled');
    expect(state.execution.modifiedFiles).toEqual([]);
    expect(model.requests).toHaveLength(3);
    await expect(
      readFile(path.join(repositoryRoot, 'src', 'RegisterUser.ts'), 'utf8'),
    ).resolves.toBe('export const validate = false\n');
  });

  it('executes an approved plan and returns its diff', async () => {
    const model = new FakeLanguageModel([
      ...explorationResponses(),
      codingPlanResponse(),
      {
        taskId: 'task-1',
        changes: [
          {
            path: 'src/RegisterUser.ts',
            operation: 'modify',
            content: 'export const validate = true\n',
          },
        ],
      },
    ]);
    const agent = createAgent(model, { requestApproval: async () => true });

    const state = await agent.execute('Validate registration email', repositoryRoot);

    expect(state).toMatchObject({
      status: 'completed',
      execution: {
        completedTaskIds: ['task-1'],
        failedTaskIds: [],
        modifiedFiles: ['src/RegisterUser.ts'],
        diff: 'final diff',
      },
      verification: { attempts: 1, lastResult: { passed: true }, corrections: [] },
    });
    await expect(
      readFile(path.join(repositoryRoot, 'src', 'RegisterUser.ts'), 'utf8'),
    ).resolves.toBe('export const validate = true\n');
  });

  it('fails before model calls or writes when Git validation fails', async () => {
    const model = new FakeLanguageModel([]);
    const agent = new RunCodingAgent({
      exploreRepository: new ExploreRepository(model, tools),
      createCodingPlan: new CreateCodingPlan(model, sandbox),
      executeCodingPlan: new ExecuteCodingPlan(model, tools),
      verifyChanges: new VerifyChanges(model, tools, new FakeTestRunner([testResult(true)])),
      planApproval: { requestApproval: async () => true },
      changeDiff: {
        validate: async () => {
          throw new Error('not a Git repository');
        },
        generate: async () => '',
      },
    });

    const state = await agent.execute('Validate registration email', repositoryRoot);

    expect(state).toMatchObject({ status: 'failed', failureReason: 'not a Git repository' });
    expect(model.requests).toHaveLength(0);
    await expect(
      readFile(path.join(repositoryRoot, 'src', 'RegisterUser.ts'), 'utf8'),
    ).resolves.toBe('export const validate = false\n');
  });

  it('preserves execution failure details when diff generation also fails', async () => {
    const model = new FakeLanguageModel([
      ...explorationResponses(),
      codingPlanResponse(),
      {
        taskId: 'task-1',
        changes: [
          { path: 'src/Unapproved.ts', operation: 'create', content: 'unapproved\n' },
        ],
      },
    ]);
    const agent = new RunCodingAgent({
      exploreRepository: new ExploreRepository(model, tools),
      createCodingPlan: new CreateCodingPlan(model, sandbox),
      executeCodingPlan: new ExecuteCodingPlan(model, tools),
      verifyChanges: new VerifyChanges(model, tools, new FakeTestRunner([testResult(true)])),
      planApproval: { requestApproval: async () => true },
      changeDiff: {
        validate: async () => undefined,
        generate: async () => {
          throw new Error('diff failed');
        },
      },
    });

    const state = await agent.execute('Validate registration email', repositoryRoot);

    expect(state).toMatchObject({
      status: 'failed',
      failureReason:
        'Execution proposal contains an unapproved file: src/Unapproved.ts; Could not generate diff: diff failed',
    });
  });

  it('corrects a failed verification and completes after tests pass', async () => {
    const model = new FakeLanguageModel([
      ...explorationResponses(),
      codingPlanResponse(),
      executionResponse('implementation before correction\n'),
      {
        analysis: 'The implementation needs the validated result.',
        changes: [
          { path: 'src/RegisterUser.ts', content: 'implementation after correction\n' },
        ],
      },
    ]);
    const agent = createAgent(
      model,
      { requestApproval: async () => true },
      new FakeTestRunner([testResult(false), testResult(true)]),
    );

    const state = await agent.execute('Validate registration email', repositoryRoot);

    expect(state).toMatchObject({
      status: 'completed',
      verification: {
        attempts: 2,
        lastResult: { passed: true },
        corrections: [
          {
            attempt: 1,
            analysis: 'The implementation needs the validated result.',
            modifiedFiles: ['src/RegisterUser.ts'],
          },
        ],
      },
      execution: { diff: 'final diff', modifiedFiles: ['src/RegisterUser.ts'] },
    });
    await expect(
      readFile(path.join(repositoryRoot, 'src', 'RegisterUser.ts'), 'utf8'),
    ).resolves.toBe('implementation after correction\n');
  });

  it('fails cleanly when tests still fail after three attempts', async () => {
    const model = new FakeLanguageModel([
      ...explorationResponses(),
      codingPlanResponse(),
      executionResponse('initial implementation\n'),
      correctionResponse('first correction\n'),
      correctionResponse('second correction\n'),
    ]);
    const runner = new FakeTestRunner([
      testResult(false),
      testResult(false),
      testResult(false),
    ]);
    const agent = createAgent(model, { requestApproval: async () => true }, runner);

    const state = await agent.execute('Validate registration email', repositoryRoot);

    expect(state).toMatchObject({
      status: 'failed',
      failureReason: 'Tests still fail after 3 attempts',
      verification: { attempts: 3, lastResult: { passed: false } },
      execution: { diff: 'final diff' },
    });
    expect(state.verification.corrections).toHaveLength(2);
    expect(runner.calls).toBe(3);
  });

  function createAgent(
    model: FakeLanguageModel,
    approval: PlanApproval,
    testRunner: TestRunner = new FakeTestRunner([testResult(true)]),
  ): RunCodingAgent {
    return new RunCodingAgent({
      exploreRepository: new ExploreRepository(model, tools),
      createCodingPlan: new CreateCodingPlan(model, sandbox),
      executeCodingPlan: new ExecuteCodingPlan(model, tools),
      verifyChanges: new VerifyChanges(model, tools, testRunner),
      planApproval: approval,
      changeDiff: { validate: async () => undefined, generate: async () => 'final diff' },
    });
  }
});

function explorationResponses(): unknown[] {
  return [
    { decision: { action: 'list_files', path: '.' } },
    {
      decision: {
        action: 'complete',
        relevantFiles: [
          { path: 'src/RegisterUser.ts', reason: 'Contains registration behavior.' },
        ],
        summary: 'Registration is implemented in RegisterUser.',
      },
    },
  ];
}

class FakeTestRunner implements TestRunner {
  calls = 0;
  readonly #results: VerificationResult[];

  constructor(results: readonly VerificationResult[]) {
    this.#results = [...results];
  }

  async run(): Promise<VerificationResult> {
    this.calls += 1;
    const result = this.#results.shift();
    if (!result) {
      throw new Error('FakeTestRunner has no results remaining');
    }
    return result;
  }
}

function testResult(passed: boolean): VerificationResult {
  return {
    passed,
    exitCode: passed ? 0 : 1,
    stdout: passed ? 'tests passed' : '',
    stderr: passed ? '' : 'tests failed',
    timedOut: false,
    outputTruncated: false,
    durationMs: 10,
  };
}

function executionResponse(content: string): unknown {
  return {
    taskId: 'task-1',
    changes: [{ path: 'src/RegisterUser.ts', operation: 'modify', content }],
  };
}

function correctionResponse(content: string): unknown {
  return {
    analysis: 'The implementation remains incorrect.',
    changes: [{ path: 'src/RegisterUser.ts', content }],
  };
}

function codingPlanResponse(): unknown {
  return {
    goal: 'Validate registration email',
    tasks: [
      {
        id: 'task-1',
        description: 'Validate registration email.',
        files: [
          {
            path: 'src/RegisterUser.ts',
            operation: 'modify',
            reason: 'Apply validation during registration.',
          },
        ],
        verification: { expectedOutcome: 'Invalid emails are rejected.' },
      },
    ],
    verificationStrategy: 'Run registration tests.',
  };
}
