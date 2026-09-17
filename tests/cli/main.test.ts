import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsolePlanApproval } from '../../src/cli/ConsolePlanApproval.js';
import { ConsoleEventSink } from '../../src/cli/ConsoleEventSink.js';
import { parseCliArguments, resolveRepositoryRoot, runCli } from '../../src/cli/main.js';
import { FakeLanguageModel } from '../helpers/FakeLanguageModel.js';

describe('CLI', () => {
  const temporaryPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.splice(0).map((temporaryPath) =>
        rm(temporaryPath, { recursive: true, force: true }),
      ),
    );
  });

  it('parses a goal and resolves the repository option', () => {
    const workingDirectory = path.join(tmpdir(), 'mini-code-working-directory');

    expect(
      parseCliArguments(['Add email validation', '--repo', './sample'], workingDirectory),
    ).toEqual({
      goal: 'Add email validation',
      repositoryRoot: path.resolve(workingDirectory, 'sample'),
    });
  });

  it('rejects a repository path that does not exist', async () => {
    const missingPath = path.join(tmpdir(), `missing-mini-code-${Date.now()}`);

    await expect(resolveRepositoryRoot(missingPath)).rejects.toThrow(
      `Repository path does not exist: ${missingPath}`,
    );
  });

  it('rejects a repository path that is a file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mini-code-cli-'));
    temporaryPaths.push(directory);
    const filePath = path.join(directory, 'file.txt');
    await writeFile(filePath, 'content');

    await expect(resolveRepositoryRoot(filePath)).rejects.toThrow(
      `Repository path is not a directory: ${filePath}`,
    );
  });

  it('renders the validated goal and repository', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'mini-code-cli-'));
    temporaryPaths.push(directory);
    await writeFile(path.join(directory, 'RegisterUser.ts'), 'export const registerUser = () => {}');
    const output: string[] = [];
    const languageModel = new FakeLanguageModel([
      {
        decision: { action: 'list_files', path: '.' },
      },
      {
        decision: {
          action: 'complete',
          relevantFiles: [
            { path: 'RegisterUser.ts', reason: 'Contains the registration operation.' },
          ],
          summary: 'Found the registration implementation.',
        },
      },
      {
        goal: 'Add email validation',
        tasks: [
          {
            id: 'task-1',
            description: 'Add validation to registration',
            files: [
              {
                path: 'RegisterUser.ts',
                operation: 'modify',
                reason: 'Registration accepts the email input.',
              },
            ],
            verification: { expectedOutcome: 'Invalid emails are rejected.' },
          },
        ],
        verificationStrategy: 'Run the registration tests.',
      },
      {
        taskId: 'task-1',
        changes: [
          {
            path: 'RegisterUser.ts',
            operation: 'modify',
            content: 'export const registerUser = () => { throw new Error("invalid email") }',
          },
        ],
      },
    ]);
    const planApproval = new ConsolePlanApproval(
      (message) => output.push(message),
      async () => 'y',
    );

    await runCli(['Add email validation', '--repo', directory], {
      languageModel,
      output: (message) => output.push(message),
      planApproval,
      changeDiff: {
        validate: async () => undefined,
        generate: async () => 'diff --git a/RegisterUser.ts b/RegisterUser.ts',
      },
      testRunner: {
        run: async () => ({
          passed: true,
          exitCode: 0,
          stdout: 'tests passed',
          stderr: '',
          timedOut: false,
          outputTruncated: false,
          durationMs: 10,
        }),
      },
      eventSink: new ConsoleEventSink(
        (message) => output.push(message),
        () => new Date('2026-09-16T14:32:01'),
      ),
    });

    expect(output).toEqual([
      'Mini Coding Agent',
      '[14:32:01] Goal received: Add email validation (' +
        `${await resolveRepositoryRoot(directory)})`,
      '[14:32:01] Exploring repository',
      '[14:32:01] Tool started: list_files',
      '[14:32:01] Tool completed: list_files',
      '[14:32:01] Exploration completed: 1 relevant file(s)',
      '[14:32:01] Creating coding plan',
      '[14:32:01] Plan created: 1 task(s)',
      '[14:32:01] Approval requested',
      'Found the registration implementation.',
      'Relevant files:',
      '- RegisterUser.ts: Contains the registration operation.',
      '1. Add validation to registration [task-1]',
      '   - modify RegisterUser.ts: Registration accepts the email input.',
      '   Expected outcome: Invalid emails are rejected.',
      'Verification strategy: Run the registration tests.',
      '[14:32:01] Plan approved',
      '[14:32:01] Executing approved plan',
      '[14:32:01] Task started: task-1 - Add validation to registration',
      '[14:32:01] Tool started: read_file',
      '[14:32:01] Tool completed: read_file',
      '[14:32:01] Tool started: edit_file',
      '[14:32:01] Tool completed: edit_file',
      '[14:32:01] File modified: RegisterUser.ts',
      '[14:32:01] Task completed: task-1',
      '[14:32:01] Running tests: attempt 1',
      '[14:32:01] Tests passed: attempt 1 (10 ms)',
      '[14:32:01] Final diff generated: 46 bytes',
      '[14:32:01] Agent completed',
      'Agent status: completed',
      'Completed tasks: task-1',
      'Modified files: RegisterUser.ts',
      'Verification: passed after 1 attempt(s)',
      'Final diff:',
      'diff --git a/RegisterUser.ts b/RegisterUser.ts',
    ]);
  });

  it('treats help as a successful CLI exit', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(runCli(['--help'], { output: vi.fn() })).resolves.toBeUndefined();

    expect(stdout).toHaveBeenCalled();
    stdout.mockRestore();
  });
});
