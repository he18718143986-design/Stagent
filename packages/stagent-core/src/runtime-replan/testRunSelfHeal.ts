import { findFixStageForTestRun } from '../gate-repair/GateRepairRouter';
import { ERROR_TYPE_TOOL_EXECUTION_FAILED } from '../errors/stageErrorBuilders';
import type { StageStepOutcome } from '../WorkflowExecutorTypes';
import { postStageError } from '../WorkflowStageErrorHelpers';
import { guardedStageTransition } from '../WorkflowStateTransitions';
import { syncInstanceStagePosition } from '../WorkflowStagePosition';
import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { readRuntimeReplanEnabled } from '../settings/readers/exec';
import type { StageStepContext } from '../stage-runners/StageStepContext';
import type { StagePostRunContext } from '../stage-runners/StagePostRunPipeline';
import type { WorkflowInstance } from '../WorkflowDefinition';
import {
  buildFixExhaustedTrigger,
  findTestRunRuntime,
  findTestRunStageIndex,
  isFixExhausted,
  isFixIfFailedStageId,
  isRuntimeReplanFixStageId,
  mergeFixChainLedger,
  readFixChainLedger,
  resetFixChainLedger,
  resolveTestRunStageIdFromFix,
  semanticFromRuntimeReplanFixStageId,
  stageHasDownstreamFixChain,
  testRunStillFailing,
} from './FixExhaustedRouter';
import { postEngineActivity } from '../engine-activity/postEngineActivity';
import { tryRuntimeReplanFromFixExhausted } from './tryRuntimeReplanFromGate';

/** test_run 再次失败时，fix 链须重入（避免 fix 仍 done → linear skip 到 delivery）。 */
export function resetFixStagePending(instance: WorkflowInstance, testRunStageId: string): void {
  const fixStage = findFixStageForTestRun(instance.definition, testRunStageId);
  if (!fixStage) {
    return;
  }
  const fixRt = instance.stageRuntimes.find((r) => r.stageId === fixStage.id);
  if (!fixRt) {
    return;
  }
  fixRt.status = 'pending';
  fixRt.completedAt = undefined;
}

/**
 * test_run 工具失败但存在 fix_if_failed：软失败为 done，保留 exit 输出，工作流继续到 fix 链。
 */
export function trySelfHealAfterTestRunFailure(
  ctx: StageStepContext,
  errorType: string,
  errPayload: Parameters<typeof postStageError>[3],
  attempt: number,
): StageStepOutcome | null {
  const { stage, runtime, instance, params } = ctx;
  if (!isTestRunStageId(stage.id) || errorType !== ERROR_TYPE_TOOL_EXECUTION_FAILED) {
    return null;
  }
  if (!stageHasDownstreamFixChain(instance.definition, stage.id)) {
    return null;
  }

  runtime.completedAt = new Date().toISOString();
  guardedStageTransition(runtime, 'done', 'test-run-soft-fail-self-heal');
  params.postMessage(params.panel, {
    type: 'stageStatusUpdate',
    stageId: stage.id,
    status: 'done',
    isDecisionStage: false,
    execSemantic: 'deferred',
  });
  postEngineActivity(params.postMessage, params.panel, {
    kind: 'verify',
    stageId: stage.id,
    text: 'test_run 软失败 → 转入 fix 链（工作流继续）',
  });
  postStageError(params.panel, params.postMessage, runtime, errPayload, { persistLastError: true });
  params.debugLog(stage.id, 'test_run_self_heal_defer', attempt, {
    fixStageId: findFixStageForTestRun(instance.definition, stage.id)?.id,
  });
  resetFixStagePending(instance, stage.id);
  params.scheduleSave();
  return 'continue';
}

function rewindToTestRun(ctx: StageStepContext, testRunStageId: string): StageStepOutcome {
  const testIdx = findTestRunStageIndex(ctx.instance, testRunStageId);
  const testRt = findTestRunRuntime(ctx.instance, testRunStageId);
  if (testIdx < 0 || !testRt) {
    return 'continue';
  }
  testRt.status = 'pending';
  ctx.instance.currentStageIndex = testIdx;
  syncInstanceStagePosition(ctx.instance);
  ctx.params.scheduleSave();
  return 'replan';
}

/** fix_if_failed 执行前：fix 链已耗尽则尝试 runtime replan。 */
export function tryFixExhaustedReplanBeforeFix(ctx: StageStepContext): StageStepOutcome | null {
  const { stage, instance, params } = ctx;
  if (!isFixIfFailedStageId(stage.id) || !readRuntimeReplanEnabled()) {
    return null;
  }
  const testRunStageId = resolveTestRunStageIdFromFix(stage.id);
  if (!testRunStageId) {
    return null;
  }
  const testRunRt = findTestRunRuntime(instance, testRunStageId);
  if (!isFixExhausted(testRunRt)) {
    return null;
  }

  const testRunStage = instance.definition.stages.find((s) => s.id === testRunStageId);
  if (!testRunStage) {
    return null;
  }

  const outcome = tryRuntimeReplanFromFixExhausted({
    loopParams: params,
    testRunStage,
    fixStage: stage,
    attempt: 0,
  });
  return outcome === 'replan' ? 'replan' : null;
}

/** fix_if_failed 成功后：计数并回绕 test_run 重跑。 */
export function afterFixIfFailedStage(ctx: StagePostRunContext): StageStepOutcome | null {
  const { stage, runtime, instance, params } = ctx;
  if (!isFixIfFailedStageId(stage.id) || runtime.status !== 'done') {
    return null;
  }
  const testRunStageId = resolveTestRunStageIdFromFix(stage.id);
  if (!testRunStageId) {
    return null;
  }
  const testRunRt = findTestRunRuntime(instance, testRunStageId);
  if (!testRunRt || !testRunStillFailing(testRunRt)) {
    return null;
  }

  const attempts = readFixChainLedger(testRunRt.outputs).attempts + 1;
  mergeFixChainLedger(testRunRt, { attempts });

  params.debugLog(stage.id, 'fix_chain_loop_back', ctx.attempt, {
    testRunStageId,
    fixAttempts: attempts,
  });
  postEngineActivity(params.postMessage, params.panel, {
    kind: 'fix',
    stageId: stage.id,
    text: `fix 链第 ${attempts} 次完成 → 回绕 ${testRunStageId}`,
  });
  params.postMessage(params.panel, {
    type: 'stageStatusUpdate',
    stageId: testRunStageId,
    status: 'pending',
    execSemantic: 'self-healing',
  });
  resetFixStagePending(instance, testRunStageId);

  const stepCtx: StageStepContext = {
    params,
    stageIndex: ctx.params.instance.definition.stages.findIndex((s) => s.id === stage.id),
    instance,
    stage,
    runtime,
    panel: params.panel,
  };
  return rewindToTestRun(stepCtx, testRunStageId);
}

/** runtime_replan_fix / runtime_replan_testfix 完成后回绕 test_run。 */
export function afterRuntimeReplanFixStage(ctx: StagePostRunContext): StageStepOutcome | null {
  const { stage, runtime, instance, params } = ctx;
  if (!isRuntimeReplanFixStageId(stage.id) || runtime.status !== 'done') {
    return null;
  }
  const semantic = semanticFromRuntimeReplanFixStageId(stage.id);
  if (!semantic) {
    return null;
  }
  const testRunStageId = `stage_test_run_${semantic}`;
  if (!instance.definition.stages.some((s) => s.id === testRunStageId)) {
    return null;
  }
  const stepCtx: StageStepContext = {
    params,
    stageIndex: instance.definition.stages.findIndex((s) => s.id === stage.id),
    instance,
    stage,
    runtime,
    panel: params.panel,
  };
  params.debugLog(stage.id, 'fix_replan_loop_back', ctx.attempt, { testRunStageId });
  resetFixChainLedger(instance, testRunStageId);
  return rewindToTestRun(stepCtx, testRunStageId);
}
