import { applyPreStageQualityGates } from '../../WorkflowStagePreGates';
import { handleQuestionBeforeGate } from '../../WorkflowStageQuestionGate';
import { emitStageError, invariantStageError } from '../../WorkflowStageErrorHelpers';
import { DECISION_STAGE_INVARIANT_I1_MSG } from '../../workflow/DecisionStageShape';
import { isDecisionLlmTextStage } from '../../workflow/StageToolKinds';
import type { StageStepOutcome } from '../../WorkflowExecutorTypes';
import {
  anyTestRunFailed,
  isDeliveryStageId,
  readBlockDeliveryOnTestFailure,
} from '../../execution/DeliveryBlockOnTestFailure';
import { failWorkflowStageFromGate } from '../../WorkflowStageGateFailure';
import { getStagentConfiguration } from '../../settings/getStagentConfiguration';
import {
  findTestRunRuntime,
  isFixExhausted,
  isFixIfFailedStageId,
  resolveTestRunStageIdFromFix,
} from '../../runtime-replan/FixExhaustedRouter';
import { tryFixExhaustedReplanBeforeFix } from '../../runtime-replan/testRunSelfHeal';
import type { StageStepContext } from '../StageStepContext';

/** skip / pre-gates / question-before / 决策阶段 invariant。返回 null 表示继续执行工具。 */
export async function runStagePrelude(ctx: StageStepContext): Promise<StageStepOutcome | null> {
  const { params, stage, runtime, instance, panel, stageIndex } = ctx;
  const { evaluateSkipCondition, postMessage, scheduleSave, logUserAction } = params;

  const taskType = instance.definition.meta?.taskType;
  const blockDelivery = readBlockDeliveryOnTestFailure(getStagentConfiguration(), taskType);

  if (isFixIfFailedStageId(stage.id) && blockDelivery) {
    const testRunStageId = resolveTestRunStageIdFromFix(stage.id);
    const testRunRt = testRunStageId ? findTestRunRuntime(instance, testRunStageId) : undefined;
    if (isFixExhausted(testRunRt)) {
      const replanOutcome = tryFixExhaustedReplanBeforeFix(ctx);
      if (replanOutcome === 'replan') {
        return replanOutcome;
      }
      return failWorkflowStageFromGate(
        params,
        stage,
        stageIndex,
        'test_run still failing after fix chain exhausted (blockDeliveryOnTestFailure)',
      );
    }
  } else {
    const fixExhaustedReplan = tryFixExhaustedReplanBeforeFix(ctx);
    if (fixExhaustedReplan !== null) {
      return fixExhaustedReplan;
    }
  }

  if (isDeliveryStageId(stage.id) && blockDelivery && anyTestRunFailed(instance.stageRuntimes)) {
    return failWorkflowStageFromGate(
      params,
      stage,
      stageIndex,
      'delivery blocked: one or more test_run stages did not pass',
    );
  }

  if (stage.skipIf && evaluateSkipCondition(stage.skipIf, instance.stageRuntimes)) {
    runtime.status = 'skipped';
    runtime.completedAt = new Date().toISOString();
    logUserAction?.('stage_skipped', {
      stageId: stage.id,
      condition: stage.skipIf,
    });
    postMessage(panel, { type: 'stageStatusUpdate', stageId: stage.id, status: 'skipped' });
    scheduleSave();
    return 'continue';
  }

  const gateAlways = await applyPreStageQualityGates(params, stage, ctx.stageIndex, 'always', 0);
  if (gateAlways === 'failed') {
    return 'failed';
  }

  const questionGate = await handleQuestionBeforeGate(
    params,
    stage,
    runtime,
    panel,
    postMessage,
    scheduleSave,
  );
  if (questionGate !== null) {
    return questionGate;
  }

  if (stage.isDecisionStage && !isDecisionLlmTextStage(stage)) {
    runtime.status = 'error';
    emitStageError(panel, postMessage, instance, invariantStageError(stage.id, DECISION_STAGE_INVARIANT_I1_MSG));
    instance.status = 'failed';
    scheduleSave();
    return 'failed';
  }

  return null;
}
