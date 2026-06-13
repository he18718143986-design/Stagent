import { isDebugTaskType } from '../workflow/TaskType';
import { hasExecutableVerificationStage } from '../plan-completeness/stageChecks';
import { PRIMARY_DECISION_OUTPUT_KEY } from '../WorkflowOutputKeys';
import { isImplStageId } from '../workflow/StageIdPatterns';
import { rule20Msg } from '../l10n/rule20Msg';
import type { VerifyContext } from './verify-context';
import { WORKFLOW_LEVEL_STAGE_ID } from '../workflow/WorkflowLevelIds';
import {
  isDebugHypothesisOrFixStage,
  isExecutableFeedbackStage,
} from '../DebugFeedbackLoopGate';

export function runDebugTaskRules(ctx: VerifyContext): void {
  if (!isDebugTaskType(ctx.workflow.meta?.taskType)) {
    return;
  }

  const { workflow, warnings } = ctx;

  const hasReproduceStage = workflow.stages.some((s) => /reproduce/i.test(s.id) || /reproduce/i.test(s.title));
  if (!hasReproduceStage) {
    warnings.push({
      type: 'debug-missing-reproduce-stage',
      stageId: WORKFLOW_LEVEL_STAGE_ID,
      message: rule20Msg('debug-missing-reproduce-stage'),
    });
  }

  const hasHypothesisStage = workflow.stages.some(
    (s) => /hypothesis|root_cause/i.test(s.id) || /假设|根因/.test(s.title),
  );
  if (!hasHypothesisStage) {
    warnings.push({
      type: 'debug-missing-hypothesis-stage',
      stageId: WORKFLOW_LEVEL_STAGE_ID,
      message: rule20Msg('debug-missing-hypothesis-stage'),
    });
  }

  if (!hasExecutableVerificationStage(workflow)) {
    warnings.push({
      type: 'debug-missing-verification-stage',
      stageId: WORKFLOW_LEVEL_STAGE_ID,
      message: rule20Msg('debug-missing-verification-stage'),
    });
  }

  const stages = workflow.stages;
  const firstFeedbackIdx = stages.findIndex((s) => isExecutableFeedbackStage(s));
  const firstHypothesisOrFixIdx = stages.findIndex((s) => isDebugHypothesisOrFixStage(s));
  if (
    firstHypothesisOrFixIdx >= 0 &&
    (firstFeedbackIdx < 0 || firstFeedbackIdx > firstHypothesisOrFixIdx)
  ) {
    warnings.push({
      type: 'debug-feedback-loop-not-first',
      stageId: WORKFLOW_LEVEL_STAGE_ID,
      message: rule20Msg('debug-feedback-loop-not-first'),
    });
  }

  const debugImplStages = workflow.stages.filter(
    (s) => (isImplStageId(s.id) && s.id.includes('_debug_')) || /debug_fix/i.test(s.id),
  );
  for (const impl of debugImplStages) {
    const hasDecisionLikeSource = impl.input.sources.some(
      (src) =>
        src.type === 'stage-output' &&
        (src.outputKey === PRIMARY_DECISION_OUTPUT_KEY ||
          /hypothesis|assumption|analysis/i.test(src.outputKey || '')),
    );
    if (!hasDecisionLikeSource) {
      warnings.push({
        type: 'debug-impl-missing-decision-source',
        stageId: impl.id,
        message: rule20Msg('debug-impl-missing-decision-source'),
      });
    }
  }
}
