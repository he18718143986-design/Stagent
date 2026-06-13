import type * as vscode from '../platform/HostTypes';
import {
  applyRetryBase,
  applyRetryForDecisionCurrent,
  applyRetryForNonDecision,
  collectDecisionRetryResets,
  guardedInstanceTransition,
} from '../WorkflowStateTransitions';
import { rollbackArtifactsForDecisionRetry, rollbackArtifactsForStage } from './ArtifactRollback';
import type { HitlCoordinatorHost } from './HitlCoordinatorHost';
import { enforceRetryLimitOrReject } from './RetryLimitGate';
import { postHitlActionHint, postHitlStageError } from './postHitlStageError';
import { HITL_HINT_NO_INSTANCE, HITL_HINT_STAGE_NOT_ACTIONABLE } from './hitlHints';
import { findHitlStage } from './resolveHitlStage';
import { DEBUG_EVENT_RETRY_TRIGGER } from '../DebugLogEvents';
import { ERROR_TYPE_INVARIANT_VIOLATION } from '../WorkflowStageErrorHelpers';
import { evaluateManualRetryLimit } from '../ManualRetryLimit';
import type { HitlRetryResult } from './HitlRetryResult';

export async function handleRetry(
  host: HitlCoordinatorHost,
  stageId: string,
  comment: string,
  panel: vscode.WebviewPanel,
): Promise<HitlRetryResult> {
  host.bindPanel(panel);
  const instance = host.getInstance();
  if (!instance) {
    postHitlActionHint(host, panel, HITL_HINT_NO_INSTANCE, stageId);
    return { ok: false, reason: 'no-instance', message: HITL_HINT_NO_INSTANCE };
  }
  const binding = findHitlStage(instance, stageId);
  if (!binding) {
    postHitlActionHint(host, panel, HITL_HINT_STAGE_NOT_ACTIONABLE, stageId);
    return { ok: false, reason: 'stage-not-actionable', message: HITL_HINT_STAGE_NOT_ACTIONABLE };
  }
  const { idx, stage, rt } = binding;
  const limit = evaluateManualRetryLimit(rt.retryCount, host.getMaxManualStageRetries());
  if (!limit.allowed) {
    enforceRetryLimitOrReject(host, panel, stageId, rt.retryCount);
    return { ok: false, reason: 'retry-limit-exceeded', message: limit.message };
  }

  host.logUserAction('retry', { stageId, commentChars: comment.length });
  host.debugLog(stageId, DEBUG_EVENT_RETRY_TRIGGER, rt.retryCount + 1, {
    reason: comment || '(empty-comment)',
    isDecisionStage: !!stage.isDecisionStage,
  });

  if (stage.isDecisionStage) {
    // Roll back BEFORE mutating retry state: a rollback failure must leave the stage in its
    // original paused/approved state with a usable retry path (no retryCount bump, no desync).
    const rollback = await rollbackArtifactsForDecisionRetry(host, panel, instance, stageId, idx, rt.retryCount + 1);
    if (!rollback.ok) {
      // rollback already posted a stageError; re-sync the stage status so the UI is not
      // stuck in an error state with the pause bar (retry) hidden.
      host.postMessage(panel, {
        type: 'stageStatusUpdate',
        stageId,
        status: rt.status,
        isDecisionStage: true,
      });
      return { ok: false, reason: 'stage-not-actionable', message: HITL_HINT_STAGE_NOT_ACTIONABLE };
    }

    applyRetryBase(rt, comment);
    applyRetryForDecisionCurrent(rt);
    const { resetStageIds, resetStageTitles } = collectDecisionRetryResets(
      instance.definition,
      instance,
      stageId,
      idx,
    );

    const i9Violations: string[] = [];
    for (const sid of resetStageIds) {
      const sidx = instance.definition.stages.findIndex((s) => s.id === sid);
      if (sidx >= 0 && instance.stageRuntimes[sidx].status !== 'pending') {
        host.error(`I-9 违反：阶段 ${sid} 未被重置到 pending`);
        i9Violations.push(sid);
      }
    }
    if (i9Violations.length > 0) {
      // Cascade reset is broken: continuing would run an inconsistent graph that looks healthy.
      // Halt and surface the error instead of advancing.
      guardedInstanceTransition(instance, 'failed', 'hitl-retry-i9-cascade-reset-failed');
      postHitlStageError(
        host,
        panel,
        stageId,
        `级联重置失败：下游阶段未被正确重置（${i9Violations.join('、')}）。已停止执行以避免不一致结果，请重新打开任务或重建工作流。`,
        ERROR_TYPE_INVARIANT_VIOLATION,
      );
      host.scheduleSave();
      return { ok: false, reason: 'stage-not-actionable', message: HITL_HINT_STAGE_NOT_ACTIONABLE };
    }

    host.postMessage(panel, {
      type: 'downstreamReset',
      decisionStageId: stageId,
      resetStageIds,
      resetStageTitles,
      rolledBackFiles: rollback.rolledBackFiles,
    });

    if (instance.status === 'completed') {
      guardedInstanceTransition(instance, 'running', 'hitl-retry-resume-from-completed');
      host.setInstanceStatus('running');
    }
  } else {
    // 非决策阶段重试：回滚该阶段自身落盘产物，避免上一轮残留文件污染重试（尽力而为，失败仅告警）。
    await rollbackArtifactsForStage(host, instance, stageId, rt.retryCount + 1);
    applyRetryBase(rt, comment);
    applyRetryForNonDecision(rt);
  }
  host.setCurrentStageIndex(idx);
  guardedInstanceTransition(instance, 'running', 'hitl-retry-resume-execution');
  host.setInstanceStatus('running');
  host.scheduleSave();
  await host.executeNextStage(panel);
  return { ok: true };
}
