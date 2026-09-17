import {
  createInitialAgentState,
  transitionAgentState,
  type AgentState,
} from '../domain/AgentState.js';
import type { ChangeDiff } from '../ports/ChangeDiff.js';
import type { PlanApproval } from '../ports/PlanApproval.js';
import type { CreateCodingPlan } from './CreateCodingPlan.js';
import type { ExecuteCodingPlan } from './ExecuteCodingPlan.js';
import type { ExploreRepository } from './ExploreRepository.js';
import type { VerifyChanges } from './VerifyChanges.js';

export interface RunCodingAgentDependencies {
  readonly exploreRepository: ExploreRepository;
  readonly createCodingPlan: CreateCodingPlan;
  readonly executeCodingPlan: ExecuteCodingPlan;
  readonly verifyChanges: VerifyChanges;
  readonly planApproval: PlanApproval;
  readonly changeDiff: ChangeDiff;
}

export class RunCodingAgent {
  constructor(private readonly dependencies: RunCodingAgentDependencies) {}

  async execute(goal: string, repositoryRoot: string): Promise<AgentState> {
    let state = createInitialAgentState(goal, repositoryRoot);

    try {
      await this.dependencies.changeDiff.validate();
      const exploration = await this.dependencies.exploreRepository.execute(goal);
      state = {
        ...transitionAgentState(state, 'planning'),
        exploration,
      };

      const plan = await this.dependencies.createCodingPlan.execute(goal, exploration);
      state = {
        ...transitionAgentState(state, 'awaiting-approval'),
        plan,
      };

      const approved = await this.dependencies.planApproval.requestApproval({ exploration, plan });
      if (!approved) {
        return transitionAgentState(state, 'cancelled');
      }

      state = transitionAgentState(state, 'executing');
      const execution = await this.dependencies.executeCodingPlan.execute(goal, plan);
      state = {
        ...state,
        execution: {
          completedTaskIds: execution.completedTaskIds,
          failedTaskIds: execution.failedTaskIds,
          modifiedFiles: execution.modifiedFiles,
        },
      };

      if (!execution.success) {
        return this.#finish(state, 'failed', execution.failureReason);
      }

      state = transitionAgentState(state, 'verifying');
      const verification = await this.dependencies.verifyChanges.execute(goal, plan);
      state = {
        ...state,
        execution: {
          ...state.execution,
          modifiedFiles: uniqueFiles([
            ...state.execution.modifiedFiles,
            ...verification.modifiedFiles,
          ]),
        },
        verification: {
          attempts: verification.attempts,
          lastResult: verification.lastResult,
          corrections: verification.corrections,
        },
      };

      if (!verification.success) {
        return this.#finish(state, 'failed', verification.failureReason);
      }

      return this.#finish(state, 'completed');
    } catch (error) {
      if (state.status === 'completed' || state.status === 'cancelled' || state.status === 'failed') {
        return state;
      }

      if (state.status === 'executing' || state.status === 'verifying') {
        return this.#finish(state, 'failed', errorMessage(error));
      }

      return { ...transitionAgentState(state, 'failed'), failureReason: errorMessage(error) };
    }
  }

  async #finish(
    state: AgentState,
    requestedStatus: 'completed' | 'failed',
    existingFailure?: string,
  ): Promise<AgentState> {
    let status = requestedStatus;
    let failureReason = existingFailure;
    let diff = '';

    try {
      diff = await this.dependencies.changeDiff.generate();
    } catch (error) {
      status = 'failed';
      const diffFailure = `Could not generate diff: ${errorMessage(error)}`;
      failureReason = failureReason ? `${failureReason}; ${diffFailure}` : diffFailure;
    }

    const finishedState = {
      ...transitionAgentState(state, status),
      execution: { ...state.execution, diff },
    };

    return failureReason ? { ...finishedState, failureReason } : finishedState;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Coding agent failed';
}

function uniqueFiles(files: readonly string[]): string[] {
  return [...new Map(files.map((file) => [file.toLowerCase(), file])).values()];
}
