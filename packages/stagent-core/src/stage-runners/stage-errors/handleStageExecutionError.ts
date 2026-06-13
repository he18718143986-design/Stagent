import { ERROR_TYPE_LLM_CONTEXT_OVERFLOW, failWorkflowStage } from '../../WorkflowStageErrorHelpers';
import type { StageStepOutcome } from '../../WorkflowExecutorTypes';
import type { StageStepContext } from '../StageStepContext';
import { buildStageErrorPayload } from './buildStageErrorPayload';
import { rollbackArtifactsForStageSync } from '../../ArtifactLifecycleManager';
import { DEBUG_EVENT_ARTIFACT_ROLLBACK } from '../../DebugLogEvents';
import { trySelfHealAfterTestRunFailure } from '../../runtime-replan/testRunSelfHeal';

/**
 * 阶段失败中止前：回滚本阶段已落盘的新建/覆盖文件（best-effort），避免半成品文件
 * 残留误导后续运行或用户。仅清理本阶段，不级联（级联回滚归决策重试路径）。
 */
function rollbackFailedStageArtifacts(ctx: StageStepContext, attempt: number): void {
  const { params, instance, stage } = ctx;
  if (!instance.artifactRegistry || instance.artifactRegistry.length === 0) {
    return;
  }
  const result = rollbackArtifactsForStageSync(instance.artifactRegistry, stage.id);
  if (result.rolledBack.length === 0 && result.failed.length === 0) {
    return;
  }
  params.debugLog(stage.id, DEBUG_EVENT_ARTIFACT_ROLLBACK, attempt, {
    scope: 'stage-fail',
    rolledBack: result.rolledBack,
    failed: result.failed,
  });
  if (!result.ok && params.warn) {
    const detail = result.failed.map((f) => `${f.filePath}: ${f.error}`).join('；');
    params.warn(`stage fail artifact rollback failed (${stage.id}): ${detail}`);
  }
}

/** 阶段 try 块异常 → stageError / failed。 */
export function handleStageExecutionError(ctx: StageStepContext, e: unknown, attempt: number): StageStepOutcome {
  const { params, runtime, instance, panel } = ctx;
  const { postMessage, scheduleSave } = params;

  const built = buildStageErrorPayload(ctx, e, attempt);
  rollbackFailedStageArtifacts(ctx, attempt);
  const selfHeal = trySelfHealAfterTestRunFailure(ctx, built.payload.errorType, built.payload, attempt);
  if (selfHeal !== null) {
    return selfHeal;
  }
  return failWorkflowStage(panel, postMessage, runtime, instance, built.payload, scheduleSave);
}
