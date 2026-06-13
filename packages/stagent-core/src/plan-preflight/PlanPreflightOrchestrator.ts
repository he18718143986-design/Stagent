import type { StructuralRepairAction } from '../WorkflowStructuralRepair';
import type { PlanCompletenessIssue } from '../plan-completeness/planCompletenessTypes';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import { compilePlan } from '../plan-compiler/compilePlan';

export type PlanPreflightPhase = 'raw' | 'final';

export type PlanPreflightResult =
  | {
      ok: true;
      workflow: WorkflowDefinition;
      repairs: StructuralRepairAction[];
      phase: PlanPreflightPhase;
    }
  | {
      blocked: true;
      workflow: WorkflowDefinition;
      issues: PlanCompletenessIssue[];
      blockReasons: string[];
      repairs: StructuralRepairAction[];
      phase: PlanPreflightPhase;
    }
  | {
      contractFailed: true;
      workflow: WorkflowDefinition;
      errors: string[];
    };

export interface RunPlanPreflightOptions {
  taskType: string;
  userInput: string;
  planCompletenessEnabled: boolean;
  structuralRepairMode: 'off' | 'auto';
  normalizeWorkflow: (wf: WorkflowDefinition, userInput: string, taskType: string) => WorkflowDefinition;
  /** true = 完整编排（raw lint → bootstrap → final lint）；false = 仅 final（bootstrap 已在外部完成） */
  fullOrchestration: boolean;
}

/**
 * Plan Preflight 编排：委托 Plan Compiler（sanitize → bootstrap → artifact graph → lint）。
 */
export function runPlanPreflight(
  wf: WorkflowDefinition,
  options: RunPlanPreflightOptions,
): PlanPreflightResult {
  return compilePlan(wf, options);
}
