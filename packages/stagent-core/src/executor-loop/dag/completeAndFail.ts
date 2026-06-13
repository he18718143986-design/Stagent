import {
  postStageError,
  invariantStageError,
  ERROR_TYPE_INVARIANT_VIOLATION,
} from '../../WorkflowStageErrorHelpers';
import type { ExecuteNextStageLoopParams } from '../../WorkflowExecutorTypes';
import { runEndContractLintSafely } from '../StageStepDriver';
import { DEBUG_EVENT_RUN_END } from '../../DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from '../../workflow/WorkflowLevelIds';
import { buildQualityReportPayload } from '../../quality-report/buildQualityReportPayload';

export async function completeDagWorkflow(
  params: ExecuteNextStageLoopParams,
  maxParallel: number,
): Promise<void> {
  const endWarnings = await runEndContractLintSafely(params);
  const { instance } = params;
  instance.status = 'completed';
  instance.completedAt = new Date().toISOString();
  params.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_RUN_END, 0, { status: 'completed', mode: 'dag', maxParallel });
  params.postMessage(params.panel, {
    type: 'workflowCompleted',
    ...(endWarnings.length > 0 ? { warnings: endWarnings } : {}),
    qualityReport: buildQualityReportPayload(instance),
  });
  params.scheduleSave();
}

export function failDagStuckPending(params: ExecuteNextStageLoopParams): void {
  const { instance } = params;
  const { definition, stageRuntimes } = instance;
  const pendingIdx = stageRuntimes.findIndex((rt) => rt.status === 'pending');
  if (pendingIdx >= 0) {
    const stageId = definition.stages[pendingIdx].id;
    stageRuntimes[pendingIdx].status = 'error';
    instance.status = 'failed';
    postStageError(
      params.panel,
      params.postMessage,
      stageRuntimes[pendingIdx],
      invariantStageError(stageId, 'DAG 调度无法找到可执行节点（可能存在循环依赖或未满足依赖）'),
    );
    params.scheduleSave();
    return;
  }

  // No pending stage but workflow is neither complete nor advancing: a failed/blocked stage
  // is stalling all downstream nodes. Fail the run instead of hanging silently.
  instance.status = 'failed';
  const erroredIdx = stageRuntimes.findIndex((rt) => rt.status === 'error');
  const erroredStageId = erroredIdx >= 0 ? definition.stages[erroredIdx]?.id : undefined;
  params.postMessage(params.panel, {
    type: 'workflowFailed',
    reason: 'DAG 调度停滞：存在失败阶段，且没有可继续执行的节点。',
    errorType: ERROR_TYPE_INVARIANT_VIOLATION,
    ...(erroredStageId ? { stageId: erroredStageId } : {}),
  });
  params.scheduleSave();
}
