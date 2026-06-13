import type { StageStepOutcome } from '../../WorkflowExecutorTypes';
import type { StagePostRunContext } from '../StagePostRunPipeline';
import { afterFixIfFailedStage, afterRuntimeReplanFixStage } from '../../runtime-replan/testRunSelfHeal';
import { evaluateHitlPause } from './HitlPauseEvaluator';
import { notifyStageStatus, schedulePauseSave } from './StageStatusNotifier';

/** LLM/工具执行成功后的 HITL 判定与状态推送。 */
export function finalizeStageAfterToolRun(ctx: StagePostRunContext): StageStepOutcome {
  const { params, stage, runtime, effectivePauseAfter, outKey, attempt, contractNode } = ctx;

  runtime.completedAt = new Date().toISOString();
  const shouldPause = evaluateHitlPause({
    params,
    stage,
    runtime,
    effectivePauseAfter,
    attempt,
    contractNode,
  });
  notifyStageStatus({ params, stage, runtime, outKey, attempt, shouldPause });

  if (runtime.status === 'paused') {
    schedulePauseSave(params);
    return 'halt';
  }

  const fixLoop = afterFixIfFailedStage(ctx);
  if (fixLoop !== null) {
    return fixLoop;
  }
  const replanFixLoop = afterRuntimeReplanFixStage(ctx);
  if (replanFixLoop !== null) {
    return replanFixLoop;
  }

  return 'continue';
}
