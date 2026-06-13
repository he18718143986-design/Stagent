import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { isSoftwareOrPrototypeTaskType } from '../workflow/TaskType';
import type { PlanCompletenessIssue } from '../PlanCompletenessGate';
import { lintPlanCompleteness } from '../PlanCompletenessGate';
import {
  STAGENT_REPAIR_MARKER,
  STAGENT_REPAIR_STAGE_ID_PREFIX,
  type ApplyStructuralRepairOptions,
  type StructuralRepairAction,
  type StructuralRepairResult,
} from './types';
import { STRUCTURAL_REPAIR_RULES } from './StructuralRepairRuleRegistry';

export function structuralRepairWarningLines(actions: StructuralRepairAction[]): string[] {
  return actions.map((a) => {
    const conf = a.pathConfidence === 'deferred' ? ':deferred-path' : '';
    return `structural-repair:insert:${a.code}:${a.stageIds.join('+')}${conf}`;
  });
}

export function formatStructuralRepairBlockReason(actions: StructuralRepairAction[]): string[] {
  if (actions.length === 0) {
    return [];
  }
  return [
    `plan_repair_attempted: 已自动插入 ${actions.length} 组阶段（${actions.map((a) => a.stageIds.join('+')).join('; ')}），但仍未通过全部结构检查，请审阅标有「${STAGENT_REPAIR_MARKER}」的阶段。`,
  ];
}

/**
 * 针对 plan completeness issues 做一轮确定性修补（M40.0 白名单）。
 */
export function applyPlanCompletenessStructuralRepairs(
  wf: WorkflowDefinition,
  issues: PlanCompletenessIssue[],
): StructuralRepairResult {
  if (issues.length === 0) {
    return { workflow: wf, changed: false, actions: [], remainingPlanIssues: [] };
  }

  let cur = wf;
  const actions: StructuralRepairAction[] = [];
  const types = new Set(issues.map((i) => i.type));

  for (const type of types) {
    const repairFn = STRUCTURAL_REPAIR_RULES[type];
    if (!repairFn) {
      continue;
    }
    const r = repairFn(cur);
    if (r.action) {
      actions.push(r.action);
      cur = r.workflow;
    }
  }

  return {
    workflow: cur,
    changed: actions.length > 0,
    actions,
    remainingPlanIssues: lintPlanCompleteness(cur),
  };
}

/** 编排：修补 → 由调用方 normalize + 再 lint。 */
export function applyPostLintStructuralRepairs(
  wf: WorkflowDefinition,
  planIssues: PlanCompletenessIssue[],
  options: ApplyStructuralRepairOptions,
): StructuralRepairResult {
  if (options.mode === 'off' || planIssues.length === 0) {
    return {
      workflow: wf,
      changed: false,
      actions: [],
      remainingPlanIssues: planIssues,
    };
  }
  const taskType = wf.meta?.taskType ?? options.taskType;
  if (!isSoftwareOrPrototypeTaskType(taskType)) {
    return {
      workflow: wf,
      changed: false,
      actions: [],
      remainingPlanIssues: planIssues,
    };
  }
  return applyPlanCompletenessStructuralRepairs(wf, planIssues);
}

export function isStagentRepairStage(stage: Stage): boolean {
  return (
    stage.id.includes(STAGENT_REPAIR_STAGE_ID_PREFIX) ||
    (stage.description?.includes(STAGENT_REPAIR_MARKER) ?? false)
  );
}
