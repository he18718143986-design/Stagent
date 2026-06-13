import {
  isImproveArchitectureTaskType,
  isPrototypeTaskType,
  isRefactorTaskType,
} from '../workflow/TaskType';
import {
  hasExecutableVerificationStage,
  isMonolithicImplStageId,
} from '../plan-completeness/stageChecks';
import {
  isRefactorDecideStageId,
  STAGE_ID_ZOOM_OUT,
} from '../workflow/StageIdPatterns';
import { rule20Msg } from '../l10n/rule20Msg';
import { verifyPrototypeImplFileReadFollowup } from './prototype';
import type { VerifyContext } from './verify-context';
import { WORKFLOW_LEVEL_STAGE_ID } from '../workflow/WorkflowLevelIds';

export function runPrototypeTaskRules(ctx: VerifyContext): void {
  if (!isPrototypeTaskType(ctx.workflow.meta?.taskType)) {
    return;
  }

  const { workflow, warnings } = ctx;

  const hasVerificationStage = hasExecutableVerificationStage(workflow);
  if (!hasVerificationStage) {
    warnings.push({
      type: 'prototype-missing-verification-stage',
      stageId: WORKFLOW_LEVEL_STAGE_ID,
      message: rule20Msg('prototype-missing-verification-stage'),
    });
  }

  const hasSuccessCriteria = workflow.stages.some((s) => {
    const text = `${s.id} ${s.title} ${s.description ?? ''} ${String((s.toolConfig as { systemPrompt?: unknown })?.systemPrompt ?? '')}`;
    return /成功判据|失败判据|acceptance|success criteria|success metric/i.test(text);
  });
  if (!hasSuccessCriteria && !hasVerificationStage) {
    warnings.push({
      type: 'prototype-missing-success-criteria',
      stageId: WORKFLOW_LEVEL_STAGE_ID,
      message: rule20Msg('prototype-missing-success-criteria'),
    });
  }

  verifyPrototypeImplFileReadFollowup(workflow, warnings);
}

export function runRefactorTaskRules(ctx: VerifyContext): void {
  if (!isRefactorTaskType(ctx.workflow.meta?.taskType)) {
    return;
  }

  const { workflow, implStages, warnings } = ctx;

  const refactorDecides = workflow.stages.filter(
    (s) => s.isDecisionStage && isRefactorDecideStageId(s.id),
  );
  if (refactorDecides.length === 0) {
    warnings.push({
      type: 'refactor-missing-decision-stage',
      stageId: WORKFLOW_LEVEL_STAGE_ID,
      message: rule20Msg('refactor-missing-decision-stage'),
    });
  }

  for (const impl of implStages) {
    if (isMonolithicImplStageId(impl.id)) {
      warnings.push({
        type: 'refactor-monolithic-impl-naming',
        stageId: impl.id,
        message: rule20Msg('refactor-monolithic-impl-naming'),
      });
    }
  }

  if (!hasExecutableVerificationStage(workflow)) {
    warnings.push({
      type: 'refactor-missing-verification-stage',
      stageId: WORKFLOW_LEVEL_STAGE_ID,
      message: rule20Msg('refactor-missing-verification-stage'),
    });
  }
}

export function runImproveArchitectureTaskRules(ctx: VerifyContext): void {
  if (!isImproveArchitectureTaskType(ctx.workflow.meta?.taskType)) {
    return;
  }

  if (!ctx.workflow.stages.some((s) => s.id === STAGE_ID_ZOOM_OUT)) {
    ctx.warnings.push({
      type: 'improve-architecture-missing-zoom-out',
      stageId: WORKFLOW_LEVEL_STAGE_ID,
      message: rule20Msg('improve-architecture-missing-zoom-out'),
    });
  }
}
