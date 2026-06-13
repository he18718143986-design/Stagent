import type { Stage, WorkflowInstance } from '../WorkflowDefinition';
import { createPendingRuntime } from './createPendingRuntime';
import { nextLedgerAfterInsert } from './replanBudget';
import type { RuntimeReplanAction, RuntimeReplanApplyResult } from './types';
import { mergeLedgerIntoRuntime, readReplanLedger } from './types';

function alignRuntimesToStages(
  stages: Stage[],
  existingRuntimes: WorkflowInstance['stageRuntimes'],
  newStage: Stage,
): { ok: true; runtimes: WorkflowInstance['stageRuntimes'] } | { ok: false; missingId: string } {
  const byId = new Map(existingRuntimes.map((rt) => [rt.stageId, rt]));
  const runtimes: WorkflowInstance['stageRuntimes'] = [];
  for (const s of stages) {
    if (s.id === newStage.id) {
      runtimes.push(createPendingRuntime(newStage));
      continue;
    }
    const rt = byId.get(s.id);
    if (!rt) {
      return { ok: false, missingId: s.id };
    }
    runtimes.push(rt);
  }
  return { ok: true, runtimes };
}

/**
 * 在 anchor 之后插入 replan stage，并对齐 stageRuntimes / currentStageIndex。
 *
 * **原地突变**（T4 Run #23 根治）：必须直接修改传入 instance 的
 * `definition.stages` / `stageRuntimes` 数组与 `currentStageIndex`，
 * 不得返回新对象——执行循环（executeNextStageLoopLinear）与外部持久化
 * 闭包都持有这些数组/对象的引用；返回新 instance 并仅替换
 * `loopParams.instance` 会导致循环继续读旧引用，插入的 replan stage
 * 永远不被执行（fix prelude 第二次进入 → already-inserted → 终态失败）。
 */
export function applyRuntimeReplan(
  instance: WorkflowInstance,
  action: RuntimeReplanAction,
): RuntimeReplanApplyResult {
  const { anchorStageId, stage: newStage, trigger } = action;
  const stages = instance.definition.stages;
  const afterIdx = stages.findIndex((s) => s.id === anchorStageId);
  if (afterIdx < 0) {
    return { ok: false, reason: 'anchor-not-found', detail: anchorStageId };
  }
  if (stages.some((s) => s.id === newStage.id)) {
    return { ok: false, reason: 'already-inserted', detail: newStage.id };
  }

  const insertIndex = afterIdx + 1;
  const stagesAfterInsert = [...stages];
  stagesAfterInsert.splice(insertIndex, 0, newStage);

  const aligned = alignRuntimesToStages(stagesAfterInsert, instance.stageRuntimes, newStage);
  if (!aligned.ok) {
    return { ok: false, reason: 'runtime-misaligned', detail: aligned.missingId };
  }

  // 校验通过后原地突变（splice 数组本体，保持外部引用一致可见）
  stages.splice(insertIndex, 0, newStage);
  instance.stageRuntimes.length = 0;
  instance.stageRuntimes.push(...aligned.runtimes);
  // 跳转到新插入的 replan stage 先执行
  instance.currentStageIndex = insertIndex;

  const testRt = instance.stageRuntimes.find((rt) => rt.stageId === trigger.testRunStageId);
  if (testRt) {
    const ledger = readReplanLedger(testRt.outputs);
    mergeLedgerIntoRuntime(
      testRt,
      nextLedgerAfterInsert(ledger, trigger.sliceSemantic, newStage.id, trigger.kind),
    );
  }

  return {
    ok: true,
    instance,
    insertedStageId: newStage.id,
    insertIndex,
    action,
  };
}
