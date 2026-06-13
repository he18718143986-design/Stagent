import type { Stage, StageRuntime, WorkflowDefinition, WorkflowInstance } from './WorkflowDefinition';
import {
  isDecideStageId,
  isImplStageId,
  isTestRunStageId,
  isTestWriteStageId,
} from './workflow/StageIdPatterns';
import { isBundleWriteStageId, isSelfHealStageId } from './workflow-self-heal/SelfHealStageFactory';
import { STAGE_IMPL_CONFTEST_ID } from './disk-bootstrap/pythonConftestStage';

/** 以 anchorIdx 所在 TDD 切片为界：上一个决策阶段之后、下一个决策阶段之前。 */
export function resolveTddSliceBounds(
  definition: WorkflowDefinition,
  anchorIdx: number,
): { start: number; end: number } {
  let start = 0;
  for (let i = anchorIdx - 1; i >= 0; i--) {
    if (definition.stages[i]?.isDecisionStage) {
      start = i + 1;
      break;
    }
  }
  let end = definition.stages.length;
  for (let i = anchorIdx + 1; i < definition.stages.length; i++) {
    if (definition.stages[i]?.isDecisionStage) {
      end = i;
      break;
    }
  }
  return { start, end };
}

export function findFirstFailedStageIndex(instance: WorkflowInstance): number {
  return instance.stageRuntimes.findIndex((r) => r.status === 'error');
}

/**
 * anchorIdx 之前、同一垂直 TDD 切片内的最后一个 impl（遇 decide 边界清零）。
 * 与 workflow-self-heal 注入链路的 lastImplBeforeRun 语义一致。
 */
export function findLastImplStageIndex(stages: readonly Stage[], anchorIdx: number): number {
  if (anchorIdx < 0 || anchorIdx >= stages.length) {
    return -1;
  }
  let last = -1;
  for (let i = 0; i < anchorIdx; i++) {
    const s = stages[i]!;
    if (isDecideStageId(s.id)) {
      last = -1;
      continue;
    }
    if (
      isImplStageId(s.id) &&
      !isBundleWriteStageId(s.id) &&
      !isSelfHealStageId(s.id) &&
      s.id !== STAGE_IMPL_CONFTEST_ID
    ) {
      last = i;
    }
  }
  return last;
}

/** 切片内 impl / test_write / test_run，供侧栏重试下拉（弥补无 stage-output 边）。 */
export function collectTddSliceRetryCandidateIds(
  definition: WorkflowDefinition,
  _stageRuntimes: StageRuntime[],
  anchorIdx: number,
): string[] {
  const { start, end } = resolveTddSliceBounds(definition, anchorIdx);
  const ids: string[] = [];
  for (let i = start; i < end; i++) {
    const id = definition.stages[i]!.id;
    if (isImplStageId(id) || isTestWriteStageId(id) || isTestRunStageId(id)) {
      ids.push(id);
    }
  }
  return ids;
}
