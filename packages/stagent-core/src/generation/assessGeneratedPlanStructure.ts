import { isSoftwareOrPrototypeTaskType, isSoftwareTaskType } from '../workflow/TaskType';
import {
  isImplStageId,
  isTestRunStageId,
  isTestWriteStageId,
} from '../workflow/StageIdPatterns';
import { lintMissingTestRunPairs } from '../plan-completeness/tddChainChecks';
import { hasExecutableVerificationStage } from '../plan-completeness/stageChecks';
import type { WorkflowDefinition } from '../WorkflowDefinition';

/** software 生成计划最少阶段数（低于此视为 LLM 截断，触发 parse 重试）。 */
export const MIN_SOFTWARE_GENERATED_STAGES = 4;

/** prototype 生成计划最少阶段数。 */
export const MIN_PROTOTYPE_GENERATED_STAGES = 2;

export type GeneratedPlanStructureIssue =
  | 'stage_count_too_low'
  | 'missing_test_run_pair'
  | 'missing_impl_for_test_write'
  | 'missing_verification_stage';

export function minGeneratedStagesForTaskType(taskType: string | undefined): number | null {
  if (taskType === 'software') {
    return MIN_SOFTWARE_GENERATED_STAGES;
  }
  if (taskType === 'prototype') {
    return MIN_PROTOTYPE_GENERATED_STAGES;
  }
  return null;
}

/**
 * 解析成功后评估计划是否「结构残缺」（阶段过少 / 缺 impl / 缺 test_run）。
 * 返回非空 reason 时，LlmParseRetryLoop 应消耗 attempt 并重跑 workflow-gen。
 */
export function assessGeneratedPlanStructure(
  wf: WorkflowDefinition,
  taskType: string,
): { issue: GeneratedPlanStructureIssue; reason: string } | null {
  const stages = wf.stages ?? [];
  const effectiveType = wf.meta?.taskType ?? taskType;
  if (!isSoftwareOrPrototypeTaskType(effectiveType)) {
    return null;
  }

  const minStages = minGeneratedStagesForTaskType(effectiveType);
  if (minStages !== null && stages.length < minStages) {
    return {
      issue: 'stage_count_too_low',
      reason: `workflow-gen 仅 ${stages.length} 个阶段，software/prototype 至少需要 ${minStages}`,
    };
  }

  if (!isSoftwareTaskType(effectiveType)) {
    return null;
  }

  const missingPairs = lintMissingTestRunPairs(wf);
  if (missingPairs.length > 0) {
    return {
      issue: 'missing_test_run_pair',
      reason: missingPairs.map((i) => i.message).join('；'),
    };
  }

  const hasTestWrite = stages.some((s) => isTestWriteStageId(s.id));
  const hasImpl = stages.some((s) => isImplStageId(s.id));
  if (hasTestWrite && !hasImpl) {
    return {
      issue: 'missing_impl_for_test_write',
      reason: 'workflow-gen 含 test_write 阶段但缺少 stage_impl_*',
    };
  }

  const needsVerify = hasTestWrite || hasImpl;
  if (needsVerify && !hasExecutableVerificationStage(wf)) {
    return {
      issue: 'missing_verification_stage',
      reason: 'workflow-gen 含 impl/test_write 但缺少 test_run 或可执行验证阶段',
    };
  }

  const hasTestRun = stages.some((s) => isTestRunStageId(s.id));
  if (hasTestWrite && !hasTestRun) {
    return {
      issue: 'missing_test_run_pair',
      reason: 'workflow-gen 含 test_write 但缺少 stage_test_run_*',
    };
  }

  return null;
}
