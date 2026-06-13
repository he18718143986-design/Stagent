import type { WorkflowInstance } from './WorkflowDefinition';
import { collectTransitiveDependencyStageIds } from './WorkflowDag';
import { countCompletedStages } from './WorkflowInstanceQuery';
import { findFirstFailedStage } from './WorkflowRecoveryViewModel';
import {
  collectTddSliceRetryCandidateIds,
  findFirstFailedStageIndex,
} from './TddSliceScope';

export interface WorkflowStageProgressInfo {
  instanceTitle: string;
  stageId: string;
  stageName: string;
  stageIndex: number;
  stageTotal: number;
  completedStages: number;
  status: string;
}

export interface RetryStageOption {
  stageId: string;
  stageName: string;
  status: string;
}

const ACTIVE_RUNTIME_STATUSES = new Set(['running', 'paused', 'retrying', 'waiting-questions']);

function buildProgressInfo(
  inst: WorkflowInstance,
  stageId: string,
  runtimeStatus: string,
): WorkflowStageProgressInfo {
  const stageTotal = inst.definition.stages.length;
  const stageIdx = inst.definition.stages.findIndex((s) => s.id === stageId);
  const stage = inst.definition.stages[stageIdx];
  return {
    instanceTitle: inst.definition.meta.title,
    stageId,
    stageName: stage?.title ?? stageId,
    stageIndex: stageIdx + 1,
    stageTotal,
    completedStages: countCompletedStages(inst),
    status: runtimeStatus,
  };
}

/** 侧栏重试下拉：失败时含 error 阶段、DAG 上游、以及 TDD 切片内 impl/test_*（弥补无 stage-output 边）。 */
export function buildRetryStageOptions(inst: WorkflowInstance): RetryStageOption[] {
  const { definition, stageRuntimes } = inst;
  const ids = new Set<string>();

  if (inst.status === 'failed') {
    const failedId = findFirstFailedStage(inst);
    const failedIdx = findFirstFailedStageIndex(inst);
    for (const rt of stageRuntimes) {
      if (rt.status === 'error') {
        ids.add(rt.stageId);
      }
    }
    if (failedId) {
      for (const depId of collectTransitiveDependencyStageIds(definition, failedId)) {
        const depIdx = definition.stages.findIndex((s) => s.id === depId);
        if (depIdx < 0) {
          continue;
        }
        const st = stageRuntimes[depIdx].status;
        if (st === 'done' || st === 'error' || st === 'paused') {
          ids.add(depId);
        }
      }
    }
    if (failedIdx >= 0) {
      for (const sid of collectTddSliceRetryCandidateIds(definition, stageRuntimes, failedIdx)) {
        ids.add(sid);
      }
    }
  } else {
    const active = stageRuntimes.find((r) => ACTIVE_RUNTIME_STATUSES.has(r.status));
    if (active && (active.status === 'paused' || active.status === 'error')) {
      ids.add(active.stageId);
    } else {
      const lastDone = [...stageRuntimes].reverse().find((r) => r.status === 'done');
      if (lastDone && inst.status === 'completed') {
        ids.add(lastDone.stageId);
      }
    }
  }

  return definition.stages
    .filter((s) => ids.has(s.id))
    .map((s) => {
      const idx = definition.stages.findIndex((st) => st.id === s.id);
      const rt = stageRuntimes[idx]!;
      return { stageId: s.id, stageName: s.title ?? s.id, status: rt.status };
    });
}

export function getCurrentStageInfo(
  inst: WorkflowInstance | undefined,
): WorkflowStageProgressInfo | undefined {
  if (!inst) {
    return;
  }
  const active = inst.stageRuntimes.find((r) => ACTIVE_RUNTIME_STATUSES.has(r.status));
  if (active) {
    return buildProgressInfo(inst, active.stageId, active.status);
  }

  if (inst.status === 'failed') {
    const failedId = findFirstFailedStage(inst);
    if (failedId) {
      const failedRt = inst.stageRuntimes.find((r) => r.stageId === failedId);
      return buildProgressInfo(inst, failedId, failedRt?.status ?? 'error');
    }
  }

  const lastDone = [...inst.stageRuntimes].reverse().find((r) => r.status === 'done');
  if (!lastDone) {
    return undefined;
  }
  return buildProgressInfo(inst, lastDone.stageId, inst.status);
}
