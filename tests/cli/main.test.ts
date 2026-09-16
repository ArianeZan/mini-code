import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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
    ]);

    await runCli(['Add email validation', '--repo', directory], {
      languageModel,
      output: (message) => output.push(message),
    });

    expect(output).toEqual([
      'Mini Coding Agent',
      'Goal: Add email validation',
      `Repository: ${await resolveRepositoryRoot(directory)}`,
      'Exploring repository...',
      'Exploration complete',
      'Found the registration implementation.',
      'Relevant files:',
      '- RegisterUser.ts: Contains the registration operation.',
      'Creating coding plan...',
      'Plan generated',
      '1. Add validation to registration [task-1]',
      '   - modify RegisterUser.ts: Registration accepts the email input.',
      '   Expected outcome: Invalid emails are rejected.',
      'Verification strategy: Run the registration tests.',
      'No files were changed.',
    ]);
  });

  it('treats help as a successful CLI exit', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(runCli(['--help'], { output: vi.fn() })).resolves.toBeUndefined();

    expect(stdout).toHaveBeenCalled();
    stdout.mockRestore();
  });
});
