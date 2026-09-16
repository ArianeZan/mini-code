import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { Command, CommanderError } from 'commander';

import { ExploreRepository } from '../agent/application/ExploreRepository.js';
import { ToolRegistry } from '../agent/application/ToolRegistry.js';
import { OpenAILanguageModel } from '../agent/infrastructure/llm/OpenAILanguageModel.js';
import { SearchCodeTool } from '../agent/infrastructure/tools/code/SearchCodeTool.js';
import { ListFilesTool } from '../agent/infrastructure/tools/filesystem/ListFilesTool.js';
import { ReadFileTool } from '../agent/infrastructure/tools/filesystem/ReadFileTool.js';
import { RepositorySandbox } from '../agent/infrastructure/tools/filesystem/RepositorySandbox.js';
import type { LanguageModel } from '../agent/ports/LanguageModel.js';

export interface CliOptions {
  readonly goal: string;
  readonly repositoryRoot: string;
}

export interface CliDependencies {
  readonly languageModel?: LanguageModel;
  readonly output?: (message: string) => void;
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
  dependencies: CliDependencies = {},
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
  const output = dependencies.output ?? console.log;

  output('Mini Coding Agent');
  output(`Goal: ${options.goal}`);
  output(`Repository: ${repositoryRoot}`);
  output('Exploring repository...');

  const sandbox = await RepositorySandbox.create(repositoryRoot);
  const tools = new ToolRegistry();
  tools.register(new ListFilesTool(sandbox));
  tools.register(new ReadFileTool(sandbox));
  tools.register(new SearchCodeTool(sandbox));

  const languageModel = dependencies.languageModel ?? new OpenAILanguageModel();
  const exploration = await new ExploreRepository(languageModel, tools).execute(options.goal);

  output('Exploration complete');
  output(exploration.summary);
  output('Relevant files:');

  if (exploration.relevantFiles.length === 0) {
    output('- None identified');
    return;
  }

  exploration.relevantFiles.forEach((file) => {
    output(`- ${file.path}: ${file.reason}`);
  });
}
