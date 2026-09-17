import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { Command, CommanderError } from 'commander';

import { CreateCodingPlan } from '../agent/application/CreateCodingPlan.js';
import { ExecuteCodingPlan } from '../agent/application/ExecuteCodingPlan.js';
import { ExploreRepository } from '../agent/application/ExploreRepository.js';
import { RunCodingAgent } from '../agent/application/RunCodingAgent.js';
import { ToolRegistry } from '../agent/application/ToolRegistry.js';
import { VerifyChanges } from '../agent/application/VerifyChanges.js';
import { OpenAILanguageModel } from '../agent/infrastructure/llm/OpenAILanguageModel.js';
import { SearchCodeTool } from '../agent/infrastructure/tools/code/SearchCodeTool.js';
import { CreateFileTool } from '../agent/infrastructure/tools/filesystem/CreateFileTool.js';
import { EditFileTool } from '../agent/infrastructure/tools/filesystem/EditFileTool.js';
import { ListFilesTool } from '../agent/infrastructure/tools/filesystem/ListFilesTool.js';
import { ReadFileTool } from '../agent/infrastructure/tools/filesystem/ReadFileTool.js';
import { RepositorySandbox } from '../agent/infrastructure/tools/filesystem/RepositorySandbox.js';
import { GitDiffTool } from '../agent/infrastructure/tools/git/GitDiffTool.js';
import { RunTestsTool } from '../agent/infrastructure/tools/testing/RunTestsTool.js';
import type { ChangeDiff } from '../agent/ports/ChangeDiff.js';
import type { EventSink } from '../agent/ports/EventSink.js';
import type { LanguageModel } from '../agent/ports/LanguageModel.js';
import type { PlanApproval } from '../agent/ports/PlanApproval.js';
import type { TestRunner } from '../agent/ports/TestingTools.js';
import { ConsolePlanApproval } from './ConsolePlanApproval.js';
import { ConsoleEventSink } from './ConsoleEventSink.js';

export interface CliOptions {
  readonly goal: string;
  readonly repositoryRoot: string;
}

export interface CliDependencies {
  readonly languageModel?: LanguageModel;
  readonly output?: (message: string) => void;
  readonly planApproval?: PlanApproval;
  readonly changeDiff?: ChangeDiff;
  readonly testRunner?: TestRunner;
  readonly eventSink?: EventSink;
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
  const eventSink = dependencies.eventSink ?? new ConsoleEventSink(output);

  output('Mini Coding Agent');

  const sandbox = await RepositorySandbox.create(repositoryRoot);
  const tools = new ToolRegistry(eventSink);
  tools.register(new ListFilesTool(sandbox));
  tools.register(new ReadFileTool(sandbox, 1_000_000));
  tools.register(new SearchCodeTool(sandbox));
  tools.register(new CreateFileTool(sandbox));
  tools.register(new EditFileTool(sandbox));

  const languageModel = dependencies.languageModel ?? new OpenAILanguageModel();
  const agent = new RunCodingAgent({
    exploreRepository: new ExploreRepository(languageModel, tools),
    createCodingPlan: new CreateCodingPlan(languageModel, sandbox),
    executeCodingPlan: new ExecuteCodingPlan(languageModel, tools, eventSink),
    verifyChanges: new VerifyChanges(
      languageModel,
      tools,
      dependencies.testRunner ?? new RunTestsTool(repositoryRoot),
      eventSink,
    ),
    planApproval: dependencies.planApproval ?? new ConsolePlanApproval(output),
    changeDiff: dependencies.changeDiff ?? new GitDiffTool(repositoryRoot),
    eventSink,
  });
  const state = await agent.execute(options.goal, repositoryRoot);

  if (state.status === 'cancelled') {
    return;
  }

  output(`Agent status: ${state.status}`);
  output(`Completed tasks: ${state.execution.completedTaskIds.join(', ') || 'none'}`);
  output(`Modified files: ${state.execution.modifiedFiles.join(', ') || 'none'}`);

  if (state.verification.attempts > 0) {
    output(
      `Verification: ${state.verification.lastResult?.passed ? 'passed' : 'failed'} after ${state.verification.attempts} attempt(s)`,
    );
    state.verification.corrections.forEach((correction) => {
      output(`Correction analysis after attempt ${correction.attempt}: ${correction.analysis}`);
    });
  }

  if (state.failureReason) {
    output(`Failure: ${state.failureReason}`);
    const lastOutput = [
      state.verification.lastResult?.stdout,
      state.verification.lastResult?.stderr,
    ]
      .filter((output): output is string => Boolean(output))
      .join('\n');
    if (lastOutput) {
      output('Last test output:');
      output(lastOutput);
    }
  }

  output('Final diff:');
  output(state.execution.diff || '(no diff)');
}
