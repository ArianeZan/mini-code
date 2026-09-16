import type { CodingPlan } from '../domain/CodingPlan.js';
import type { RepositoryExploration } from '../domain/RepositoryExploration.js';

export interface PlanApprovalContext {
  readonly exploration: RepositoryExploration;
  readonly plan: CodingPlan;
}

export interface PlanApproval {
  requestApproval(context: PlanApprovalContext): Promise<boolean>;
}
