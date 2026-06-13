import { planCompletenessMsg } from '../l10n/lintMsg';
import { isSoftwareTaskType } from '../workflow/TaskType';
import {
  isImplStageId,
  isTestRunStageId,
  isTestWriteStageId,
  semanticNameFromTestWriteStageId,
  testRunStageIdFromSemanticName,
} from '../workflow/StageIdPatterns';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import { hasExecutableVerificationStage } from './stageChecks';
import type { PlanCompletenessIssue } from './planCompletenessTypes';

/** 每个 stage_test_write_* 必须有同语义 stage_test_run_*。 */
export function lintMissingTestRunPairs(wf: WorkflowDefinition): PlanCompletenessIssue[] {
  const issues: PlanCompletenessIssue[] = [];
  const runIds = new Set((wf.stages ?? []).filter((s) => isTestRunStageId(s.id)).map((s) => s.id));

  for (const stage of wf.stages ?? []) {
    if (!isTestWriteStageId(stage.id)) {
      continue;
    }
    const semantic = semanticNameFromTestWriteStageId(stage.id);
    if (!semantic) {
      continue;
    }
    const expectedRunId = testRunStageIdFromSemanticName(semantic);
    if (!runIds.has(expectedRunId)) {
      issues.push({
        type: 'missing-test-run-pair',
        message: planCompletenessMsg('missing-test-run-pair', stage.id, expectedRunId),
      });
    }
  }
  return issues;
}

/** software：存在 test_write 或 impl 时必须有可执行验证（test_run / code-runner）。 */
export function lintSoftwareRequiresVerification(wf: WorkflowDefinition): PlanCompletenessIssue | null {
  if (!isSoftwareTaskType(wf.meta?.taskType)) {
    return null;
  }
  const stages = wf.stages ?? [];
  const needsVerify =
    stages.some((s) => isTestWriteStageId(s.id)) || stages.some((s) => isImplStageId(s.id));
  if (!needsVerify || hasExecutableVerificationStage(wf)) {
    return null;
  }
  return {
    type: 'missing-verification-stage',
    message: planCompletenessMsg('missing-verification-stage'),
  };
}
