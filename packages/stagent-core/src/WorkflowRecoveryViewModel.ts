import type { BackendMessage, StageStatus, WorkflowInstance } from './WorkflowDefinition';
import { syncDagCurrentStageIndex } from './WorkflowDag';
import { enrichStageErrorPayload } from './WorkflowStageErrorHelpers';

/** 首个 status=error 的阶段 id（用于 instanceResumed.failedStageId）。 */
export function findFirstFailedStage(instance: WorkflowInstance): string | undefined {
  for (const rt of instance.stageRuntimes) {
    if (rt.status === 'error') {
      return rt.stageId;
    }
  }
  return undefined;
}

/**
 * 执行中/失败/已完成实例恢复：不发 workflowGenerated（避免误切 confirm），
 * 首条 instanceResumed 进 execution，其后重放阶段状态与持久化错误。
 */
export function buildExecutionRecoveryMessages(
  instance: WorkflowInstance,
  instanceKey: string,
): BackendMessage[] {
  const failedStageId = findFirstFailedStage(instance);
  const failedRt = failedStageId
    ? instance.stageRuntimes.find((r) => r.stageId === failedStageId)
    : undefined;
  const stageStatuses: Record<string, StageStatus> = {};
  for (const rt of instance.stageRuntimes) {
    stageStatuses[rt.stageId] = rt.status;
  }
  const messages: BackendMessage[] = [
    {
      type: 'instanceResumed',
      resync: true,
      instanceKey,
      workflow: instance.definition,
      instanceStatus: instance.status,
      stageStatuses,
      ...(failedStageId ? { failedStageId } : {}),
      ...(instance.status === 'failed' && failedRt?.lastError
        ? {
            failedSummary: {
              error: failedRt.lastError.error,
              errorType: failedRt.lastError.errorType,
            },
          }
        : instance.status === 'failed'
          ? {
              failedSummary: {
                error: '工作流执行失败，请重试失败阶段或从头重新执行。',
                errorType: 'unknown' as const,
              },
            }
          : {}),
    },
  ];
  messages.push(...buildStageReplayMessages(instance, stageStatuses));
  return messages;
}

function buildStageReplayMessages(
  instance: WorkflowInstance,
  stageStatuses: Record<string, StageStatus>,
): BackendMessage[] {
  const messages: BackendMessage[] = [];
  for (const rt of instance.stageRuntimes) {
    const stage = instance.definition.stages.find((s) => s.id === rt.stageId);
    if (stageStatuses[rt.stageId] !== rt.status) {
      messages.push({
        type: 'stageStatusUpdate',
        stageId: rt.stageId,
        status: rt.status,
        isDecisionStage: stage?.isDecisionStage,
      });
    }
    for (const [outputKey, content] of Object.entries(rt.outputs)) {
      messages.push({ type: 'stageOutputUpdate', stageId: rt.stageId, outputKey, content });
    }
    if (rt.status === 'paused' && stage?.questionAfter?.length) {
      messages.push({
        type: 'stageQuestions',
        stageId: rt.stageId,
        questions: stage.questionAfter,
      });
    }
    if (rt.status === 'error' && rt.lastError) {
      messages.push({
        type: 'stageError',
        ...enrichStageErrorPayload({
          stageId: rt.stageId,
          error: rt.lastError.error,
          errorType: rt.lastError.errorType,
          stdout: rt.lastError.stdout,
          stderr: rt.lastError.stderr,
        }),
      });
    }
  }
  return messages;
}

export function findInterruptedRunningStageIndex(instance: WorkflowInstance): number {
  return instance.stageRuntimes.findIndex((r) => r.status === 'running' || r.status === 'retrying');
}

/**
 * #11：恢复 running 实例前，重置所有中断的 running/retrying 阶段为 pending。
 * DAG 模式下重置全部并行中断阶段并 syncDagCurrentStageIndex；线性模式对齐首个中断下标。
 */
export function resetInterruptedExecutionStages(instance: WorkflowInstance): number[] {
  const resetIndices: number[] = [];
  for (let i = 0; i < instance.stageRuntimes.length; i++) {
    const rt = instance.stageRuntimes[i];
    if (rt.status === 'running' || rt.status === 'retrying') {
      rt.status = 'pending';
      rt.startedAt = undefined;
      rt.completedAt = undefined;
      resetIndices.push(i);
    }
  }
  if (resetIndices.length === 0) {
    return resetIndices;
  }
  if (instance.definition.globalConfig?.enableDagScheduler === true) {
    syncDagCurrentStageIndex(instance);
  } else {
    instance.currentStageIndex = resetIndices[0];
  }
  return resetIndices;
}
