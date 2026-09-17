import {
  createInitialAgentState,
  transitionAgentState,
  type AgentState,
} from '../domain/AgentState.js';
import type { ChangeDiff } from '../ports/ChangeDiff.js';
import {
  NO_OP_EVENT_SINK,
  emitSafely,
  type EventSink,
} from '../ports/EventSink.js';
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
  readonly eventSink?: EventSink;
}

export class RunCodingAgent {
  constructor(private readonly dependencies: RunCodingAgentDependencies) {}

  async execute(goal: string, repositoryRoot: string): Promise<AgentState> {
    let state = createInitialAgentState(goal, repositoryRoot);
    const eventSink = this.dependencies.eventSink ?? NO_OP_EVENT_SINK;
    emitSafely(eventSink, { type: 'goal-received', goal, repositoryRoot });

    try {
      await this.dependencies.changeDiff.validate();
      emitSafely(eventSink, { type: 'exploration-started' });
      const exploration = await this.dependencies.exploreRepository.execute(goal);
      emitSafely(eventSink, { type: 'exploration-completed', exploration });
      state = {
        ...transitionAgentState(state, 'planning'),
        exploration,
      };

      emitSafely(eventSink, { type: 'planning-started' });
      const plan = await this.dependencies.createCodingPlan.execute(goal, exploration);
      emitSafely(eventSink, { type: 'plan-created', plan });
      state = {
        ...transitionAgentState(state, 'awaiting-approval'),
        plan,
      };

      emitSafely(eventSink, { type: 'approval-requested' });
      const approved = await this.dependencies.planApproval.requestApproval({ exploration, plan });
      if (!approved) {
        emitSafely(eventSink, { type: 'approval-rejected' });
        emitSafely(eventSink, { type: 'agent-cancelled' });
        return transitionAgentState(state, 'cancelled');
      }

      emitSafely(eventSink, { type: 'approval-granted' });
      emitSafely(eventSink, { type: 'execution-started' });
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
        return this.#finish(state, 'failed', execution.failureReason, eventSink);
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
        return this.#finish(state, 'failed', verification.failureReason, eventSink);
      }

      return this.#finish(state, 'completed', undefined, eventSink);
    } catch (error) {
      if (state.status === 'completed' || state.status === 'cancelled' || state.status === 'failed') {
        return state;
      }

      if (state.status === 'executing' || state.status === 'verifying') {
        return this.#finish(state, 'failed', errorMessage(error), eventSink);
      }

      const failureReason = errorMessage(error);
      emitSafely(eventSink, { type: 'agent-failed', reason: failureReason });
      return { ...transitionAgentState(state, 'failed'), failureReason };
    }
  }

  async #finish(
    state: AgentState,
    requestedStatus: 'completed' | 'failed',
    existingFailure?: string,
    eventSink: EventSink = NO_OP_EVENT_SINK,
  ): Promise<AgentState> {
    let status = requestedStatus;
    let failureReason = existingFailure;
    let diff = '';

    try {
      diff = await this.dependencies.changeDiff.generate();
      emitSafely(eventSink, {
        type: 'diff-generated',
        bytes: Buffer.byteLength(diff, 'utf8'),
      });
    } catch (error) {
      status = 'failed';
      const diffFailure = `Could not generate diff: ${errorMessage(error)}`;
      failureReason = failureReason ? `${failureReason}; ${diffFailure}` : diffFailure;
    }

    const finishedState = {
      ...transitionAgentState(state, status),
      execution: { ...state.execution, diff },
    };

    if (status === 'completed') {
      emitSafely(eventSink, { type: 'agent-completed' });
    } else {
      emitSafely(eventSink, {
        type: 'agent-failed',
        reason: failureReason ?? 'Coding agent failed',
      });
    }

    return failureReason ? { ...finishedState, failureReason } : finishedState;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Coding agent failed';
}

function uniqueFiles(files: readonly string[]): string[] {
  return [...new Map(files.map((file) => [file.toLowerCase(), file])).values()];
}
