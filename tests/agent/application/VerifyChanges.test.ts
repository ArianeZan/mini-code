import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolRegistry } from '../../../src/agent/application/ToolRegistry.js';
import { VerifyChanges } from '../../../src/agent/application/VerifyChanges.js';
import type { CodingPlan } from '../../../src/agent/domain/CodingPlan.js';
import { EditFileTool } from '../../../src/agent/infrastructure/tools/filesystem/EditFileTool.js';
import { ReadFileTool } from '../../../src/agent/infrastructure/tools/filesystem/ReadFileTool.js';
import { RepositorySandbox } from '../../../src/agent/infrastructure/tools/filesystem/RepositorySandbox.js';
import type {
  TestRunner,
  VerificationResult,
} from '../../../src/agent/ports/TestingTools.js';
import { FakeLanguageModel } from '../../helpers/FakeLanguageModel.js';

describe('VerifyChanges', () => {
  let repositoryRoot: string;
  let tools: ToolRegistry;

  beforeEach(async () => {
    repositoryRoot = await mkdtemp(path.join(tmpdir(), 'mini-code-verify-'));
    await mkdir(path.join(repositoryRoot, 'src'));
    await writeFile(path.join(repositoryRoot, 'src', 'RegisterUser.ts'), 'invalid implementation\n');

    const sandbox = await RepositorySandbox.create(repositoryRoot);
    tools = new ToolRegistry();
    tools.register(new ReadFileTool(sandbox, 1_000_000));
    tools.register(new EditFileTool(sandbox));
  });

  afterEach(async () => {
    await rm(repositoryRoot, { recursive: true, force: true });
  });

  it('completes without an LLM call when tests pass first time', async () => {
    const model = new FakeLanguageModel([]);
    const runner = new FakeTestRunner([testResult(true)]);

    const result = await new VerifyChanges(model, tools, runner).execute('Fix registration', plan);

    expect(result).toMatchObject({
      success: true,
      attempts: 1,
      corrections: [],
      modifiedFiles: [],
    });
    expect(model.requests).toHaveLength(0);
    expect(runner.calls).toBe(1);
  });

  it('applies a correction and reruns tests', async () => {
    const model = new FakeLanguageModel([
      {
        analysis: 'The implementation still returns the invalid value.',
        changes: [
          { path: './src/RegisterUser.ts', content: 'valid implementation\n' },
        ],
      },
    ]);
    const runner = new FakeTestRunner([testResult(false), testResult(true)]);

    const result = await new VerifyChanges(model, tools, runner).execute('Fix registration', plan);

    expect(result).toMatchObject({
      success: true,
      attempts: 2,
      corrections: [
        {
          attempt: 1,
          analysis: 'The implementation still returns the invalid value.',
          modifiedFiles: ['src/RegisterUser.ts'],
        },
      ],
      modifiedFiles: ['src/RegisterUser.ts'],
    });
    await expect(
      readFile(path.join(repositoryRoot, 'src', 'RegisterUser.ts'), 'utf8'),
    ).resolves.toBe('valid implementation\n');
  });

  it('fails after three test attempts without applying a third correction', async () => {
    const model = new FakeLanguageModel([
      correctionResponse('first correction\n'),
      correctionResponse('second correction\n'),
    ]);
    const runner = new FakeTestRunner([
      testResult(false),
      testResult(false),
      testResult(false),
    ]);

    const result = await new VerifyChanges(model, tools, runner).execute('Fix registration', plan);

    expect(result).toMatchObject({
      success: false,
      attempts: 3,
      failureReason: 'Tests still fail after 3 attempts',
    });
    expect(result.corrections).toHaveLength(2);
    expect(model.requests).toHaveLength(2);
    expect(runner.calls).toBe(3);
  });

  it('rejects corrections outside the approved plan', async () => {
    const model = new FakeLanguageModel([
      {
        analysis: 'Change another file.',
        changes: [{ path: 'src/Unapproved.ts', content: 'unapproved\n' }],
      },
    ]);
    const runner = new FakeTestRunner([testResult(false)]);

    const result = await new VerifyChanges(model, tools, runner).execute('Fix registration', plan);

    expect(result).toMatchObject({
      success: false,
      attempts: 1,
      failureReason: 'Verification correction contains an unapproved file: src/Unapproved.ts',
    });
    expect(runner.calls).toBe(1);
  });

  it('validates every correction path before editing any file', async () => {
    const model = new FakeLanguageModel([
      {
        analysis: 'Attempt an invalid multi-file correction.',
        changes: [
          { path: 'src/RegisterUser.ts', content: 'must not be written\n' },
          { path: 'src/Unapproved.ts', content: 'unapproved\n' },
        ],
      },
    ]);
    const runner = new FakeTestRunner([testResult(false)]);

    const result = await new VerifyChanges(model, tools, runner).execute('Fix registration', plan);

    expect(result).toMatchObject({
      success: false,
      corrections: [{ attempt: 1, modifiedFiles: [] }],
    });
    await expect(
      readFile(path.join(repositoryRoot, 'src', 'RegisterUser.ts'), 'utf8'),
    ).resolves.toBe('invalid implementation\n');
  });

  it('converts test runner exceptions into controlled failure', async () => {
    const model = new FakeLanguageModel([]);
    const runner = new FakeTestRunner([new Error('runner unavailable')]);

    const result = await new VerifyChanges(model, tools, runner).execute('Fix registration', plan);

    expect(result).toMatchObject({
      success: false,
      attempts: 1,
      failureReason: 'Could not run tests: runner unavailable',
      lastResult: { passed: false, stderr: 'runner unavailable' },
    });
  });

  it('rejects corrections whose aggregate content is too large', async () => {
    await writeFile(path.join(repositoryRoot, 'src', 'HelperA.ts'), 'helper a\n');
    await writeFile(path.join(repositoryRoot, 'src', 'HelperB.ts'), 'helper b\n');
    const expandedPlan: CodingPlan = {
      ...plan,
      tasks: [
        {
          ...plan.tasks[0]!,
          files: [
            ...plan.tasks[0]!.files,
            {
              path: 'src/HelperA.ts',
              operation: 'modify',
              reason: 'Supports registration.',
            },
            {
              path: 'src/HelperB.ts',
              operation: 'modify',
              reason: 'Supports registration.',
            },
          ],
        },
      ],
    };
    const model = new FakeLanguageModel([
      {
        analysis: 'Produce an oversized correction.',
        changes: [
          { path: 'src/RegisterUser.ts', content: 'x'.repeat(700_000) },
          { path: 'src/HelperA.ts', content: 'y'.repeat(700_000) },
          { path: 'src/HelperB.ts', content: 'z'.repeat(700_000) },
        ],
      },
    ]);
    const runner = new FakeTestRunner([testResult(false)]);

    const result = await new VerifyChanges(model, tools, runner).execute(
      'Fix registration',
      expandedPlan,
    );

    expect(result).toMatchObject({ success: false, attempts: 1 });
    expect(result.success || result.failureReason).toContain('exceeds 2000000 bytes');
  });
});

const plan: CodingPlan = {
  goal: 'Fix registration',
  tasks: [
    {
      id: 'task-1',
      description: 'Fix registration.',
      files: [
        {
          path: 'src/RegisterUser.ts',
          operation: 'modify',
          reason: 'Contains the registration implementation.',
        },
      ],
      verification: { expectedOutcome: 'Registration works.' },
    },
  ],
  verificationStrategy: 'Run tests.',
};

class FakeTestRunner implements TestRunner {
  calls = 0;
  readonly #results: Array<VerificationResult | Error>;

  constructor(results: readonly (VerificationResult | Error)[]) {
    this.#results = [...results];
  }

  async run(): Promise<VerificationResult> {
    this.calls += 1;
    const result = this.#results.shift();
    if (!result) {
      throw new Error('FakeTestRunner has no results remaining');
    }
    if (result instanceof Error) {
      throw result;
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

function correctionResponse(content: string): unknown {
  return {
    analysis: 'The implementation is still incorrect.',
    changes: [{ path: 'src/RegisterUser.ts', content }],
  };
}
