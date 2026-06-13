import type { StageRuntime, WorkflowDefinition, WorkflowInstance } from '../WorkflowDefinition';
import type { StageFailureSnapshot } from '../workflow-types/RuntimeTypes';

/** reset test_run 为 pending，供 impl 修复后自动重跑；保留 test_write 为 done（linear 调度会 skip）。 */
export function resetFailedTestRunForUpstreamFix(runtime: StageRuntime): void {
  runtime.status = 'pending';
  runtime.outputs = {};
  runtime.startedAt = undefined;
  runtime.completedAt = undefined;
  delete runtime.lastError;
  delete runtime.lastFailureSnapshot;
}

/** upstream-fix 在 reset test_run 前复制 snapshot，避免 findFirstFailedStageIndex 失效后 impl 无上下文。 */
export function copyFailureSnapshotForUpstreamFix(
  source: StageRuntime,
  target: StageRuntime,
): boolean {
  const snap = source.lastFailureSnapshot;
  if (!snap) {
    return false;
  }
  target.lastFailureSnapshot = {
    ...snap,
    outputs: { ...snap.outputs },
  };
  return true;
}

export function collectUpstreamFixResets(
  definition: WorkflowDefinition,
  instance: WorkflowInstance,
  failedTestRunStageId: string,
): { resetStageIds: string[]; resetStageTitles: string[] } {
  const resetStageIds: string[] = [];
  const resetStageTitles: string[] = [];
  const idx = definition.stages.findIndex((s) => s.id === failedTestRunStageId);
  if (idx < 0) {
    return { resetStageIds, resetStageTitles };
  }
  const rt = instance.stageRuntimes[idx];
  if (!rt) {
    return { resetStageIds, resetStageTitles };
  }
  resetFailedTestRunForUpstreamFix(rt);
  resetStageIds.push(failedTestRunStageId);
  resetStageTitles.push(definition.stages[idx]!.title);
  return { resetStageIds, resetStageTitles };
}

export function hasFailureSnapshot(runtime: StageRuntime): runtime is StageRuntime & {
  lastFailureSnapshot: StageFailureSnapshot;
} {
  return runtime.lastFailureSnapshot !== undefined;
}
