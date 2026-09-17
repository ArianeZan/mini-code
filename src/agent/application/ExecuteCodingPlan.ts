import type { CodingPlan, CodingTask } from '../domain/CodingPlan.js';
import { TaskExecutionProposalSchema } from '../domain/TaskExecutionProposal.js';
import { ReadFileOutputSchema } from '../ports/RepositoryTools.js';
import type { LanguageModel } from '../ports/LanguageModel.js';
import {
  NO_OP_EVENT_SINK,
  emitSafely,
  type EventSink,
} from '../ports/EventSink.js';
import type { ToolRegistry } from './ToolRegistry.js';

const EXECUTION_INSTRUCTIONS = `Implement exactly one approved coding task.
Return complete UTF-8 content for every file listed in the task, with the same path and operation.
Preserve unrelated behavior and formatting in modified files.
Do not add, remove, rename, or change the operation of any file.
Do not return Markdown, patches, shell commands, or explanations.`;

export type PlanExecutionResult =
  | {
      readonly success: true;
      readonly completedTaskIds: string[];
      readonly failedTaskIds: [];
      readonly modifiedFiles: string[];
    }
  | {
      readonly success: false;
      readonly completedTaskIds: string[];
      readonly failedTaskIds: string[];
      readonly modifiedFiles: string[];
      readonly failureReason: string;
    };

export class ExecuteCodingPlan {
  constructor(
    private readonly languageModel: LanguageModel,
    private readonly tools: ToolRegistry,
    private readonly eventSink: EventSink = NO_OP_EVENT_SINK,
  ) {}

  async execute(goal: string, plan: CodingPlan): Promise<PlanExecutionResult> {
    const completedTaskIds: string[] = [];
    const modifiedFiles = new Set<string>();

    for (const task of plan.tasks) {
      emitSafely(this.eventSink, {
        type: 'task-started',
        taskId: task.id,
        description: task.description,
      });
      const taskResult = await this.#executeTask(goal, task);

      if (!taskResult.success) {
        emitSafely(this.eventSink, {
          type: 'task-failed',
          taskId: task.id,
          reason: taskResult.failureReason,
        });
        taskResult.modifiedFiles.forEach((file) => modifiedFiles.add(file));
        return {
          success: false,
          completedTaskIds,
          failedTaskIds: [task.id],
          modifiedFiles: [...modifiedFiles],
          failureReason: taskResult.failureReason,
        };
      }

      taskResult.modifiedFiles.forEach((file) => modifiedFiles.add(file));
      completedTaskIds.push(task.id);
      emitSafely(this.eventSink, { type: 'task-completed', taskId: task.id });
    }

    return {
      success: true,
      completedTaskIds,
      failedTaskIds: [],
      modifiedFiles: [...modifiedFiles],
    };
  }

  async #executeTask(
    goal: string,
    task: CodingTask,
  ): Promise<
    | { success: true; modifiedFiles: string[] }
    | { success: false; failureReason: string; modifiedFiles: string[] }
  > {
    const modifiedFiles: string[] = [];
    const currentFiles: Array<{
      path: string;
      operation: 'create' | 'modify';
      content: string | null;
    }> = [];

    for (const file of task.files) {
      if (file.operation === 'create') {
        currentFiles.push({ path: file.path, operation: file.operation, content: null });
        continue;
      }

      const readResult = await this.tools.execute('read_file', { path: file.path });
      if (!readResult.ok) {
        return taskFailure(readResult.error.message, modifiedFiles);
      }

      const currentFile = ReadFileOutputSchema.parse(readResult.value);
      if (currentFile.truncated) {
        return taskFailure(`File is too large for safe editing: ${file.path}`, modifiedFiles);
      }

      currentFiles.push({
        path: currentFile.path,
        operation: file.operation,
        content: currentFile.content,
      });
    }

    let proposal;
    try {
      proposal = await this.languageModel.generate({
        schemaName: 'task_execution_proposal',
        schema: TaskExecutionProposalSchema,
        instructions: EXECUTION_INSTRUCTIONS,
        input: JSON.stringify({ goal, task, currentFiles }),
      });
    } catch (error) {
      return taskFailure(errorMessage(error), modifiedFiles);
    }

    if (proposal.taskId !== task.id) {
      return taskFailure(
        `Execution proposal task ID does not match ${task.id}`,
        modifiedFiles,
      );
    }

    const approvedFiles = new Map(
      task.files.map((file) => [repositoryPathKey(file.path), file]),
    );
    const proposedChanges = new Map<string, (typeof proposal.changes)[number]>();

    for (const change of proposal.changes) {
      const pathKey = repositoryPathKey(normalizeProposalPath(change.path));
      const approvedFile = approvedFiles.get(pathKey);

      if (!approvedFile) {
        return taskFailure(
          `Execution proposal contains an unapproved file: ${change.path}`,
          modifiedFiles,
        );
      }

      if (proposedChanges.has(pathKey)) {
        return taskFailure(`Execution proposal repeats a file: ${change.path}`, modifiedFiles);
      }

      if (change.operation !== approvedFile.operation) {
        return taskFailure(
          `Execution proposal changes the approved operation for ${approvedFile.path}`,
          modifiedFiles,
        );
      }

      proposedChanges.set(pathKey, change);
    }

    if (proposedChanges.size !== approvedFiles.size) {
      const missingFile = task.files.find(
        (file) => !proposedChanges.has(repositoryPathKey(file.path)),
      );
      return taskFailure(
        `Execution proposal omitted an approved file: ${missingFile?.path ?? task.id}`,
        modifiedFiles,
      );
    }

    for (const approvedFile of task.files) {
      const change = proposedChanges.get(repositoryPathKey(approvedFile.path));
      if (!change) {
        return taskFailure(
          `Execution proposal omitted an approved file: ${approvedFile.path}`,
          modifiedFiles,
        );
      }

      const toolName = approvedFile.operation === 'create' ? 'create_file' : 'edit_file';
      const writeResult = await this.tools.execute(toolName, {
        path: approvedFile.path,
        content: change.content,
      });

      if (!writeResult.ok) {
        return taskFailure(writeResult.error.message, modifiedFiles);
      }

      modifiedFiles.push(approvedFile.path);
      emitSafely(this.eventSink, {
        type: approvedFile.operation === 'create' ? 'file-created' : 'file-modified',
        path: approvedFile.path,
        taskId: task.id,
      });
    }

    return { success: true, modifiedFiles };
  }
}

function normalizeProposalPath(repositoryPath: string): string {
  return repositoryPath.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '');
}

function repositoryPathKey(repositoryPath: string): string {
  return normalizeProposalPath(repositoryPath).toLowerCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Task execution failed';
}

function taskFailure(
  failureReason: string,
  modifiedFiles: readonly string[],
): { success: false; failureReason: string; modifiedFiles: string[] } {
  return { success: false, failureReason, modifiedFiles: [...modifiedFiles] };
}
