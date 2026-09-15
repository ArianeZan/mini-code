import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { Command, CommanderError } from 'commander';

export interface CliOptions {
  readonly goal: string;
  readonly repositoryRoot: string;
}

export function parseCliArguments(
  argv: readonly string[],
  defaultRepositoryRoot = process.cwd(),
): CliOptions {
  const program = new Command()
    .name('mini-code')
    .description('A small, explicit coding agent for local repositories')
    .argument('<goal>', 'coding goal to accomplish')
    .option('--repo <path>', 'repository root', defaultRepositoryRoot)
    .allowExcessArguments(false)
    .exitOverride();

  program.parse([...argv], { from: 'user' });

  const goal = program.args[0];
  const options = program.opts<{ repo: string }>();

  if (!goal) {
    throw new Error('A coding goal is required');
  }

  return {
    goal,
    repositoryRoot: path.resolve(defaultRepositoryRoot, options.repo),
  };
}

export async function resolveRepositoryRoot(repositoryRoot: string): Promise<string> {
  let repositoryStats;

  try {
    repositoryStats = await stat(repositoryRoot);
  } catch {
    throw new Error(`Repository path does not exist: ${repositoryRoot}`);
  }

  if (!repositoryStats.isDirectory()) {
    throw new Error(`Repository path is not a directory: ${repositoryRoot}`);
  }

  return realpath(repositoryRoot);
}

export async function runCli(
  argv: readonly string[],
  output: (message: string) => void = console.log,
): Promise<void> {
  let options;

  try {
    options = parseCliArguments(argv);
  } catch (error) {
    if (error instanceof CommanderError && error.code === 'commander.helpDisplayed') {
      return;
    }

    throw error;
  }

  const repositoryRoot = await resolveRepositoryRoot(options.repositoryRoot);

  output('Mini Coding Agent');
  output(`Goal: ${options.goal}`);
  output(`Repository: ${repositoryRoot}`);
  output('Bootstrap ready. Repository exploration arrives in Milestone 2.');
}
