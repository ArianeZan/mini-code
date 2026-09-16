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

export interface RunCodingAgentDependencies {
  readonly exploreRepository: ExploreRepository;
  readonly createCodingPlan: CreateCodingPlan;
  readonly executeCodingPlan: ExecuteCodingPlan;
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
      let diff = '';

      try {
        diff = await this.dependencies.changeDiff.generate();
      } catch (error) {
        const diffFailure = `Could not generate diff: ${errorMessage(error)}`;
        const failureReason = execution.success
          ? diffFailure
          : `${execution.failureReason}; ${diffFailure}`;
        return {
          ...transitionAgentState(state, 'failed'),
          execution: {
            ...state.execution,
            completedTaskIds: execution.completedTaskIds,
            failedTaskIds: execution.failedTaskIds,
            modifiedFiles: execution.modifiedFiles,
          },
          failureReason,
        };
      }

      state = {
        ...state,
        execution: {
          completedTaskIds: execution.completedTaskIds,
          failedTaskIds: execution.failedTaskIds,
          modifiedFiles: execution.modifiedFiles,
          diff,
        },
      };

      if (!execution.success) {
        return {
          ...transitionAgentState(state, 'failed'),
          failureReason: execution.failureReason,
        };
      }

      return transitionAgentState(state, 'completed');
    } catch (error) {
      if (state.status === 'completed' || state.status === 'cancelled' || state.status === 'failed') {
        return state;
      }

      return {
        ...transitionAgentState(state, 'failed'),
        failureReason: errorMessage(error),
      };
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Coding agent failed';
}
