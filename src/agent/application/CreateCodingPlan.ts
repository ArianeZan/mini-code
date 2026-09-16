import path from 'node:path';

import { CodingPlanSchema, type CodingPlan } from '../domain/CodingPlan.js';
import { isRestrictedRepositoryPath } from '../domain/RepositoryPathPolicy.js';
import type { RepositoryExploration } from '../domain/RepositoryExploration.js';
import type { LanguageModel } from '../ports/LanguageModel.js';
import type { RepositoryPathInspector } from '../ports/RepositoryPathInspector.js';

const PLANNING_INSTRUCTIONS = `Create an ordered implementation plan for the coding goal using the repository exploration.
Return concrete tasks with stable unique IDs, affected files, and an expected verification outcome.
Use operation "modify" only for files listed as relevant by the exploration.
Use operation "create" only for new repository-relative files that are necessary for the goal.
Do not propose deletion, shell commands, Git operations, or files outside the repository.
Keep tasks small, sequential, and implementation-oriented. Do not write code.`;

export class CreateCodingPlan {
  constructor(
    private readonly languageModel: LanguageModel,
    private readonly repositoryPaths: RepositoryPathInspector,
  ) {}

  async execute(goal: string, exploration: RepositoryExploration): Promise<CodingPlan> {
    const generatedPlan = await this.languageModel.generate({
      schemaName: 'coding_plan',
      schema: CodingPlanSchema,
      instructions: PLANNING_INSTRUCTIONS,
      input: JSON.stringify({ goal, exploration }),
    });

    const relevantFiles = new Map<string, string>();
    for (const file of exploration.relevantFiles) {
      const pathKey = repositoryPathKey(file.path);
      const existingPath = relevantFiles.get(pathKey);

      if (existingPath && existingPath !== file.path) {
        throw new Error(
          `Exploration contains non-portable path casing: ${existingPath}, ${file.path}`,
        );
      }

      relevantFiles.set(pathKey, file.path);
    }
    const taskIds = new Set<string>();
    const plannedCreations = new Set<string>();

    const tasks = [];

    for (const task of generatedPlan.tasks) {
      if (taskIds.has(task.id)) {
        throw new Error(`Coding plan contains duplicate task ID: ${task.id}`);
      }
      taskIds.add(task.id);

      const taskFiles = new Set<string>();
      const files = [];

      for (const file of task.files) {
        const normalizedPath = normalizePlannedPath(file.path);
        const pathKey = repositoryPathKey(normalizedPath);

        if (taskFiles.has(pathKey)) {
          throw new Error(`Task ${task.id} references a file more than once: ${normalizedPath}`);
        }
        taskFiles.add(pathKey);

        if (isRestrictedRepositoryPath(normalizedPath)) {
          throw new Error(`Plan contains a restricted repository path: ${normalizedPath}`);
        }

        const discoveredPath = relevantFiles.get(pathKey);
        if (file.operation === 'modify' && !discoveredPath) {
          throw new Error(`Plan cannot modify an unexplored file: ${normalizedPath}`);
        }

        const pathExists = await this.repositoryPaths.exists(normalizedPath);
        if (file.operation === 'modify' && !pathExists) {
          throw new Error(`Plan cannot modify a missing file: ${normalizedPath}`);
        }

        if (file.operation === 'create' && pathExists) {
          throw new Error(`Plan cannot create an existing file: ${normalizedPath}`);
        }

        if (file.operation === 'create') {
          await this.repositoryPaths.assertCanCreate(normalizedPath);
        }

        if (file.operation === 'create' && plannedCreations.has(pathKey)) {
          throw new Error(`Plan cannot create the same file twice: ${normalizedPath}`);
        }

        if (file.operation === 'create') {
          plannedCreations.add(pathKey);
        }

        files.push({
          ...file,
          path: discoveredPath ?? normalizedPath,
        });
      }

      tasks.push({ ...task, files });
    }

    return {
      ...generatedPlan,
      goal,
      tasks,
    };
  }
}

function normalizePlannedPath(repositoryPath: string): string {
  const normalizedPath = repositoryPath.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '');
  const segments = normalizedPath.split('/');

  if (
    normalizedPath === '' ||
    normalizedPath.endsWith('/') ||
    path.posix.isAbsolute(normalizedPath) ||
    path.win32.isAbsolute(normalizedPath) ||
    segments.includes('..') ||
    segments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment.includes(':') ||
        isInvalidWindowsPathSegment(segment),
    )
  ) {
    throw new Error(`Plan contains an invalid repository path: ${repositoryPath}`);
  }

  return normalizedPath;
}

function repositoryPathKey(repositoryPath: string): string {
  return repositoryPath.toLowerCase();
}

function isInvalidWindowsPathSegment(segment: string): boolean {
  const baseName = segment.split('.')[0]?.toUpperCase();
  return (
    /[<>"|?*\u0000-\u001F]/.test(segment) ||
    segment.endsWith('.') ||
    segment.endsWith(' ') ||
    baseName === 'CON' ||
    baseName === 'PRN' ||
    baseName === 'AUX' ||
    baseName === 'NUL' ||
    /^COM[1-9]$/.test(baseName ?? '') ||
    /^LPT[1-9]$/.test(baseName ?? '')
  );
}
