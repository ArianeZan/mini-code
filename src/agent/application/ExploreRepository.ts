import {
  ExplorationDecisionSchema,
  type ExplorationDecision,
} from '../domain/ExplorationDecision.js';
import type { RepositoryExploration } from '../domain/RepositoryExploration.js';
import {
  ListFilesOutputSchema,
  ReadFileOutputSchema,
  SearchCodeOutputSchema,
} from '../ports/RepositoryTools.js';
import type { LanguageModel } from '../ports/LanguageModel.js';
import type { ToolResult } from '../ports/Tool.js';
import type { ToolRegistry } from './ToolRegistry.js';

export const MAX_EXPLORATION_STEPS = 12;

type ExplorationObservation = {
  readonly action: Exclude<ExplorationDecision['action'], 'complete'> | 'completion_rejected';
  readonly input: Record<string, string>;
  readonly result: ToolResult<unknown> | { readonly unknownRelevantFiles: string[] };
};

const EXPLORATION_INSTRUCTIONS = `You are exploring a local code repository for a coding goal.
Choose exactly one action per response.
Use list_files with a repository-relative directory path, normally ".", to discover structure.
Use search_code with a relative path and a literal query to locate symbols or behavior.
Use read_file only for files likely to clarify the goal.
Complete only when you can identify relevant files from observed tool results and briefly justify each one.
Do not invent paths and do not propose code changes.`;

export class ExploreRepository {
  constructor(
    private readonly languageModel: LanguageModel,
    private readonly tools: ToolRegistry,
    private readonly maxSteps = MAX_EXPLORATION_STEPS,
  ) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) {
      throw new Error('Exploration steps must be a positive safe integer');
    }
  }

  async execute(goal: string): Promise<RepositoryExploration> {
    const observations: ExplorationObservation[] = [];
    const discoveredFiles = new Map<string, string>();

    for (let step = 1; step <= this.maxSteps; step += 1) {
      const response = await this.languageModel.generate({
        schemaName: 'repository_exploration_decision',
        schema: ExplorationDecisionSchema,
        instructions: EXPLORATION_INSTRUCTIONS,
        input: JSON.stringify({
          goal,
          step,
          maximumSteps: this.maxSteps,
          availableTools: this.tools.list(),
          observations,
        }),
      });
      const { decision } = response;

      if (decision.action === 'complete') {
        const relevantFiles = decision.relevantFiles.map((file) => {
          const normalizedPath = normalizeRepositoryPath(file.path);
          return {
            ...file,
            path: discoveredFiles.get(repositoryPathKey(normalizedPath)) ?? normalizedPath,
          };
        });
        const unknownRelevantFiles = relevantFiles
          .map((file) => file.path)
          .filter((filePath) => !discoveredFiles.has(repositoryPathKey(filePath)));

        if (unknownRelevantFiles.length === 0) {
          return { relevantFiles, summary: decision.summary };
        }

        observations.push({
          action: 'completion_rejected',
          input: {},
          result: { unknownRelevantFiles },
        });
        continue;
      }

      const observation = await this.#executeDecision(decision, discoveredFiles);
      observations.push(observation);
    }

    throw new Error(`Repository exploration exceeded ${this.maxSteps} steps`);
  }

  async #executeDecision(
    decision: Exclude<ExplorationDecision, { action: 'complete' }>,
    discoveredFiles: Map<string, string>,
  ): Promise<ExplorationObservation> {
    switch (decision.action) {
      case 'list_files': {
        const input = { path: decision.path };
        const result = await this.tools.execute('list_files', input);

        if (result.ok) {
          const output = ListFilesOutputSchema.parse(result.value);
          output.entries
            .filter((entry) => entry.type === 'file')
            .forEach((entry) => rememberDiscoveredFile(discoveredFiles, entry.path));
        }

        return { action: decision.action, input, result };
      }
      case 'read_file': {
        const input = { path: decision.path };
        const result = await this.tools.execute('read_file', input);

        if (result.ok) {
          const output = ReadFileOutputSchema.parse(result.value);
          rememberDiscoveredFile(discoveredFiles, output.path);
        }

        return { action: decision.action, input, result };
      }
      case 'search_code': {
        const input = { path: decision.path, query: decision.query };
        const result = await this.tools.execute('search_code', input);

        if (result.ok) {
          const output = SearchCodeOutputSchema.parse(result.value);
          output.matches.forEach((match) => rememberDiscoveredFile(discoveredFiles, match.path));
        }

        return { action: decision.action, input, result };
      }
    }
  }
}

function normalizeRepositoryPath(repositoryPath: string): string {
  return repositoryPath.replaceAll('\\', '/').replace(/^\.\//, '');
}

function repositoryPathKey(repositoryPath: string): string {
  const normalizedPath = normalizeRepositoryPath(repositoryPath);
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

function rememberDiscoveredFile(files: Map<string, string>, repositoryPath: string): void {
  files.set(repositoryPathKey(repositoryPath), repositoryPath);
}
