import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import type { PlanCompletenessIssue, PlanCompletenessViolationType } from '../PlanCompletenessGate';

export const STAGENT_REPAIR_STAGE_ID_PREFIX = 'stagent_';
export const STAGENT_REPAIR_MARKER = '[系统插入 · M40]';

export type StructuralRepairPathConfidence = 'high' | 'deferred';

export interface StructuralRepairAction {
  source: 'plan-completeness';
  code: PlanCompletenessViolationType;
  action: 'insert-stage';
  stageIds: string[];
  pathConfidence: StructuralRepairPathConfidence;
  message: string;
}

export interface StructuralRepairResult {
  workflow: WorkflowDefinition;
  changed: boolean;
  actions: StructuralRepairAction[];
  remainingPlanIssues: PlanCompletenessIssue[];
}

export type PlanStructuralRepairMode = 'off' | 'auto';

export interface ApplyStructuralRepairOptions {
  mode: PlanStructuralRepairMode;
  userInput: string;
  taskType: string;
}

export type RepairFn = (wf: WorkflowDefinition) => {
  workflow: WorkflowDefinition;
  action?: StructuralRepairAction;
};

export type { Stage, WorkflowDefinition };
