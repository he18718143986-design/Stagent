import type * as vscode from '../platform/HostTypes';
import {
  blocksDirectApproveForQuestionAfter,
  isPlainApproveAllowedForStage,
} from '../QuestionAfterFlow';
import { markApproved } from '../WorkflowStateTransitions';
import { emitStageDoneAdvancePersist } from '../WorkflowEngineContinuation';
import type { HitlCoordinatorHost } from './HitlCoordinatorHost';
import { advanceStageAfterHitl } from './advanceAfterHitl';
import { postApproveInvariantError } from './approveInvariantErrors';
import { postHitlActionHint } from './postHitlStageError';
import { HITL_HINT_NO_INSTANCE, HITL_HINT_STAGE_NOT_ACTIONABLE } from './hitlHints';
import { requirePausedStageAtCurrent } from './resolveHitlStage';

export async function handleApprove(
  host: HitlCoordinatorHost,
  stageId: string,
  panel: vscode.WebviewPanel,
): Promise<void> {
  host.bindPanel(panel);
  const instance = host.getInstance();
  if (!instance) {
    postHitlActionHint(host, panel, HITL_HINT_NO_INSTANCE, stageId);
    return;
  }
  const binding = requirePausedStageAtCurrent(instance, stageId);
  if (!binding) {
    postHitlActionHint(host, panel, HITL_HINT_STAGE_NOT_ACTIONABLE, stageId);
    return;
  }
  const { stage, rt } = binding;

  if (!isPlainApproveAllowedForStage(stage)) {
    postApproveInvariantError(
      host,
      panel,
      stageId,
      'I-20: 决策阶段不允许通过普通 approve 推进，请使用「批准决策」按钮提交 decisionRecord。',
      'approve_rejected_decision_stage',
    );
    return;
  }

  if (blocksDirectApproveForQuestionAfter(stage)) {
    host.warn(
      `I-追问: 阶段 ${stageId} 含 questionAfter，必须通过 Webview 提交答案（answerQuestions），禁止直接 approve`,
    );
    postHitlActionHint(
      host,
      panel,
      '该阶段包含需要回答的问题，请在问题面板提交答案以继续，而不是直接「批准」。',
      stageId,
    );
    return;
  }
  host.logUserAction('approve', { stageId });
  host.markStageArtifactsApproved(stageId);
  markApproved(rt, new Date().toISOString());
  emitStageDoneAdvancePersist({
    emit: (msg) => host.postMessage(panel, msg),
    stageId,
    decisionUiFlag: 'omit',
    bumpStageIndex: () => host.bumpCurrentStageIndex(),
    scheduleSave: () => host.scheduleSave(),
  });
  host.persistMilestone();
  await advanceStageAfterHitl(host, panel);
}
