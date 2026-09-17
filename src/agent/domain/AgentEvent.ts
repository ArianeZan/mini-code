import type { CodingPlan } from './CodingPlan.js';
import type { RepositoryExploration } from './RepositoryExploration.js';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type AgentEvent =
  | { readonly type: 'goal-received'; readonly goal: string; readonly repositoryRoot: string }
  | { readonly type: 'exploration-started' }
  | {
      readonly type: 'exploration-completed';
      readonly exploration: DeepReadonly<RepositoryExploration>;
    }
  | { readonly type: 'planning-started' }
  | { readonly type: 'plan-created'; readonly plan: DeepReadonly<CodingPlan> }
  | { readonly type: 'approval-requested' }
  | { readonly type: 'approval-granted' }
  | { readonly type: 'approval-rejected' }
  | { readonly type: 'execution-started' }
  | { readonly type: 'task-started'; readonly taskId: string; readonly description: string }
  | { readonly type: 'task-completed'; readonly taskId: string }
  | { readonly type: 'task-failed'; readonly taskId: string; readonly reason: string }
  | { readonly type: 'file-created'; readonly path: string; readonly taskId: string }
  | { readonly type: 'file-modified'; readonly path: string; readonly taskId?: string }
  | { readonly type: 'tool-started'; readonly toolName: string }
  | {
      readonly type: 'tool-completed';
      readonly toolName: string;
      readonly success: boolean;
      readonly errorCode?: string;
    }
  | { readonly type: 'verification-started'; readonly attempt: number }
  | {
      readonly type: 'verification-passed';
      readonly attempt: number;
      readonly durationMs: number;
    }
  | {
      readonly type: 'verification-failed';
      readonly attempt: number;
      readonly exitCode: number | null;
      readonly timedOut: boolean;
      readonly outputTruncated: boolean;
    }
  | {
      readonly type: 'correction-proposed';
      readonly attempt: number;
      readonly files: readonly string[];
    }
  | {
      readonly type: 'correction-applied';
      readonly attempt: number;
      readonly files: readonly string[];
    }
  | {
      readonly type: 'correction-rejected';
      readonly attempt: number;
      readonly reason: string;
    }
  | { readonly type: 'diff-generated'; readonly bytes: number }
  | { readonly type: 'agent-completed' }
  | { readonly type: 'agent-cancelled' }
  | { readonly type: 'agent-failed'; readonly reason: string };
