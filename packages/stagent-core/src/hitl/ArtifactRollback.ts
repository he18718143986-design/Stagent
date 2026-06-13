import type * as vscode from '../platform/HostTypes';
import { ArtifactLifecycleManager } from '../ArtifactLifecycleManager';
import { listDecisionRetryResetStageIds } from '../WorkflowStateTransitions';
import type { WorkflowInstance } from '../WorkflowDefinition';
import type { HitlCoordinatorHost } from './HitlCoordinatorHost';
import { postHitlStageError } from './postHitlStageError';
import { DEBUG_EVENT_ARTIFACT_ROLLBACK } from '../DebugLogEvents';
import { ERROR_TYPE_INVARIANT_VIOLATION } from '../WorkflowStageErrorHelpers';

export type ArtifactRollbackResult =
  | { ok: true; rolledBackFiles?: string[] }
  | { ok: false };

/**
 * 非决策阶段 retry / onError=fail 时：仅回滚该阶段自身的落盘产物（不级联下游）。
 * 失败仅告警，不阻断（与决策重试的强一致要求不同——这里是尽力而为的清理）。
 */
export async function rollbackArtifactsForStage(
  host: Pick<HitlCoordinatorHost, 'warn' | 'debugLog'>,
  instance: WorkflowInstance,
  stageId: string,
  retryCount: number,
): Promise<string[]> {
  if (!instance.artifactRegistry) {
    return [];
  }
  const artifactMgr = new ArtifactLifecycleManager(instance.artifactRegistry);
  const result = await artifactMgr.rollbackArtifactsForStage(stageId);
  host.debugLog(stageId, DEBUG_EVENT_ARTIFACT_ROLLBACK, retryCount, {
    scope: 'single-stage',
    rolledBack: result.rolledBack,
    failed: result.failed,
  });
  if (!result.ok) {
    const detail = result.failed.map((f) => `${f.filePath}: ${f.error}`).join('；');
    host.warn(`stage artifact rollback failed (${stageId}): ${detail}`);
  }
  return result.rolledBack;
}

export async function rollbackArtifactsForDecisionRetry(
  host: HitlCoordinatorHost,
  panel: vscode.WebviewPanel,
  instance: WorkflowInstance,
  stageId: string,
  stageIndex: number,
  retryCount: number,
): Promise<ArtifactRollbackResult> {
  if (!instance.artifactRegistry) {
    return { ok: true };
  }
  const artifactMgr = new ArtifactLifecycleManager(instance.artifactRegistry);
  const resetStageIds = listDecisionRetryResetStageIds(instance.definition, stageId, stageIndex);
  const toRollback = artifactMgr.getArtifactsForStageIds(resetStageIds);
  if (toRollback.length === 0) {
    return { ok: true };
  }
  const rollbackResult = await artifactMgr.rollbackArtifacts(toRollback);
  host.debugLog(stageId, DEBUG_EVENT_ARTIFACT_ROLLBACK, retryCount, {
    count: toRollback.length,
    rolledBack: rollbackResult.rolledBack,
    failed: rollbackResult.failed,
  });
  if (!rollbackResult.ok) {
    const detail = rollbackResult.failed.map((f) => `${f.filePath}: ${f.error}`).join('；');
    host.warn(`artifact rollback failed: ${detail}`);
    postHitlStageError(host, panel, stageId, `决策重试磁盘回滚失败：${detail}`, ERROR_TYPE_INVARIANT_VIOLATION);
    return { ok: false };
  }
  return { ok: true, rolledBackFiles: rollbackResult.rolledBack };
}
