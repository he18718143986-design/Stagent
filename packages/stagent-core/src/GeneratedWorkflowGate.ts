import { lintPlanCompleteness, formatPlanCompletenessBlockReason } from './PlanCompletenessGate';
import type { PlanCompletenessIssue, PlanCompletenessViolationType } from './plan-completeness/planCompletenessTypes';
import { isSoftwareTaskType } from './workflow/TaskType';
import type { WorkflowDefinition } from './WorkflowDefinition';
import type { VerifyIssue, VerifyResult } from './Rule20Verify';
import { formatRule20IssueLine } from './Rule20RuntimeGate';

/** 生成期必须硬阻断的计划完整性违规（不依赖 plan.requireCompleteness 开关）。 */
export const PLAN_COMPLETENESS_HARD_BLOCK_TYPES: ReadonlySet<PlanCompletenessViolationType> = new Set([
  'missing-test-run-pair',
  'missing-verification-stage',
  'express-incompatible-module-layout',
  'multi-module-insufficient-slices',
  'test-write-import-not-in-plan',
  'test-write-import-undeclared',
]);

export function filterHardBlockPlanCompletenessIssues(
  issues: PlanCompletenessIssue[],
): PlanCompletenessIssue[] {
  return issues.filter((i) => PLAN_COMPLETENESS_HARD_BLOCK_TYPES.has(i.type));
}

export function hardBlockPlanCompletenessIssues(
  wf: WorkflowDefinition,
  taskType: string,
): PlanCompletenessIssue[] {
  const effectiveType = wf.meta?.taskType ?? taskType;
  if (!isSoftwareTaskType(effectiveType)) {
    return [];
  }
  return filterHardBlockPlanCompletenessIssues(lintPlanCompleteness(wf));
}

export function formatHardPlanCompletenessBlockReason(issues: PlanCompletenessIssue[]): string {
  return formatPlanCompletenessBlockReason(issues);
}

export function shouldBlockGenerateOnHardPlanCompleteness(
  wf: WorkflowDefinition,
  taskType: string,
): boolean {
  return hardBlockPlanCompletenessIssues(wf, taskType).length > 0;
}

/** M20.2.1：violations 阻断 generateWorkflow 时的 reason 文案 */
export function formatRule20ViolationsBlockReason(violations: VerifyIssue[]): string {
  if (violations.length === 0) {
    return 'rule20: no violations';
  }
  const lines = violations.map((v) => formatRule20IssueLine(v, 'violation'));
  const head = lines.slice(0, 3).join('; ');
  const tail = violations.length > 3 ? ` (+${violations.length - 3} more)` : '';
  return `generated_workflow_rule20_violations: ${head}${tail}`;
}

export function shouldBlockGenerateOnRule20Violations(
  verifyResult: VerifyResult | undefined,
  runtimeRule20Enabled: boolean,
): boolean {
  return runtimeRule20Enabled && !!verifyResult && verifyResult.violations.length > 0;
}
