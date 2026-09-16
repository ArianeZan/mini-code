import type { CodingPlan } from './CodingPlan.js';
import type { RepositoryExploration } from './RepositoryExploration.js';

export type AgentStatus =
  | 'exploring'
  | 'planning'
  | 'awaiting-approval'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface AgentState {
  readonly goal: string;
  readonly repositoryRoot: string;
  readonly status: AgentStatus;
  readonly exploration?: RepositoryExploration;
  readonly plan?: CodingPlan;
  readonly execution: {
    readonly currentTaskId?: string;
    readonly completedTaskIds: string[];
    readonly failedTaskIds: string[];
    readonly modifiedFiles: string[];
    readonly diff?: string;
  };
  readonly verification: {
    readonly attempts: number;
  };
  readonly failureReason?: string;
}

const ALLOWED_TRANSITIONS: Record<AgentStatus, readonly AgentStatus[]> = {
  exploring: ['planning', 'failed'],
  planning: ['awaiting-approval', 'failed'],
  'awaiting-approval': ['executing', 'cancelled', 'failed'],
  executing: ['verifying', 'completed', 'failed'],
  verifying: ['executing', 'completed', 'failed'],
  completed: [],
  cancelled: [],
  failed: [],
};

export function createInitialAgentState(goal: string, repositoryRoot: string): AgentState {
  return {
    goal,
    repositoryRoot,
    status: 'exploring',
    execution: {
      completedTaskIds: [],
      failedTaskIds: [],
      modifiedFiles: [],
    },
    verification: { attempts: 0 },
  };
}

export function transitionAgentState(state: AgentState, status: AgentStatus): AgentState {
  if (!ALLOWED_TRANSITIONS[state.status].includes(status)) {
    throw new Error(`Invalid agent transition: ${state.status} -> ${status}`);
  }

  return { ...state, status };
}
