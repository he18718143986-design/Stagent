import { DEFAULT_CONFIDENCE_PAUSE_THRESHOLD } from '../StagentSettingsDefaults';
import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import type { WorkflowDefinition } from '../WorkflowDefinition';

/** Rule20 to-issues：HITL 比例偏高阈值（与 `DEFAULT_CONFIDENCE_PAUSE_THRESHOLD` 数值相同，语义独立）。 */
export const TO_ISSUES_HIGH_HITL_RATIO_THRESHOLD = DEFAULT_CONFIDENCE_PAUSE_THRESHOLD;

const MONOLITHIC_IMPL_STAGE_ID_SUFFIX = /(all|core|everything|global|system)$/i;

/** 是否存在可执行验证阶段（code-runner 或 stage_test_run_*）。 */
export function hasExecutableVerificationStage(wf: WorkflowDefinition): boolean {
  return (wf.stages ?? []).some((s) => isCodeRunnerTool(s.tool) || isTestRunStageId(s.id));
}

export function isMonolithicImplStageId(stageId: string): boolean {
  return MONOLITHIC_IMPL_STAGE_ID_SUFFIX.test(stageId);
}
