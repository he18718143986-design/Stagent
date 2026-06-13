import type { StageStepContext } from '../StageStepContext';
import { DEBUG_EVENT_STAGE_START, DEBUG_EVENT_TOOL_CONFIG_SNAPSHOT } from '../../DebugLogEvents';

/** 标记阶段 running 并推送 UI 状态。 */
export function markStageRunning(ctx: StageStepContext): number {
  const { stage, runtime, panel, params } = ctx;
  const effectivePauseAfter = stage.isDecisionStage ? true : stage.pauseAfter;
  runtime.status = runtime.status === 'retrying' ? 'retrying' : 'running';
  runtime.startedAt = runtime.startedAt ?? new Date().toISOString();
  const attempt = runtime.retryCount + 1;
  params.debugLog(stage.id, DEBUG_EVENT_STAGE_START, attempt, { tool: stage.tool, pauseAfter: effectivePauseAfter });
  params.debugLog(stage.id, DEBUG_EVENT_TOOL_CONFIG_SNAPSHOT, attempt, stage.toolConfig);
  params.postMessage(panel, {
    type: 'stageStatusUpdate',
    stageId: stage.id,
    status: 'running',
    isDecisionStage: stage.isDecisionStage,
  });
  return attempt;
}

export function effectivePauseAfterForStage(ctx: StageStepContext): boolean {
  const { stage } = ctx;
  return stage.isDecisionStage ? true : stage.pauseAfter;
}
