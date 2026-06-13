import type { GateResult } from '../QualityGate';
import {
  isRepairableGateBlock,
  parseGateRepairIssue,
  resolveGateRepairWriteTarget,
} from '../gate-repair/GateRepairRouter';
import { semanticNameFromTestRunStageId } from '../workflow/StageIdPatterns';
import type { ExecuteNextStageLoopParams } from '../WorkflowExecutorTypes';
import type { Stage } from '../WorkflowDefinition';
import { syncInstanceStagePosition } from '../WorkflowStagePosition';
import { readRuntimeReplanEnabled } from '../settings/readers/exec';
import { applyRuntimeReplan } from './applyRuntimeReplan';
import {
  buildPreflightConftestTrigger,
  buildPreflightPytestAsyncioTrigger,
  isPreflightConftestBlock,
  isPreflightPytestAsyncioBlock,
} from './PreflightReplanRouter';
import {
  buildFixExhaustedTrigger,
  resolveFixReplanWriteTarget,
} from './FixExhaustedRouter';
import { planDeterministicReplan } from './planDeterministicReplan';
import { postEngineActivity } from '../engine-activity/postEngineActivity';
import type { RuntimeReplanTrigger } from './types';

export type RuntimeReplanGateOutcome = 'replan' | 'not-applied';

function buildGateRepairExhaustedTrigger(testRunStageId: string, block: GateResult): RuntimeReplanTrigger | null {
  const semantic = semanticNameFromTestRunStageId(testRunStageId);
  if (!semantic || !isRepairableGateBlock(block.gateId)) {
    return null;
  }
  return {
    kind: 'gate-repair-exhausted',
    testRunStageId,
    sliceSemantic: semantic,
    gateId: block.gateId,
    message: block.messages.join('; '),
  };
}

function deferTestRunExecution(instance: ExecuteNextStageLoopParams['instance'], testRunStageId: string): void {
  const rt = instance.stageRuntimes.find((r) => r.stageId === testRunStageId);
  if (rt && (rt.status === 'running' || rt.status === 'retrying')) {
    rt.status = 'pending';
  }
}

function executeRuntimeReplan(params: {
  loopParams: ExecuteNextStageLoopParams;
  testRunStage: Stage;
  trigger: RuntimeReplanTrigger;
  attempt: number;
  gateRepairWriteTarget?: string;
  logContext: Record<string, unknown>;
}): RuntimeReplanGateOutcome {
  const { loopParams, testRunStage, trigger, attempt, gateRepairWriteTarget, logContext } = params;
  const action = planDeterministicReplan({
    trigger,
    instance: loopParams.instance,
    gateRepairWriteTarget,
  });
  if (!action) {
    loopParams.debugLog(testRunStage.id, 'runtime_replan_skipped', attempt, {
      ...logContext,
      reason: 'no-plan-or-budget',
    });
    return 'not-applied';
  }

  loopParams.debugLog(testRunStage.id, 'runtime_replan_planned', attempt, {
    ...logContext,
    trigger: trigger.kind,
    anchorStageId: action.anchorStageId,
    insertedStageId: action.stage.id,
  });

  const applied = applyRuntimeReplan(loopParams.instance, action);
  if (!applied.ok) {
    loopParams.debugLog(testRunStage.id, 'runtime_replan_skipped', attempt, {
      ...logContext,
      reason: applied.reason,
      detail: applied.detail,
    });
    return 'not-applied';
  }

  loopParams.instance = applied.instance;
  deferTestRunExecution(loopParams.instance, testRunStage.id);
  syncInstanceStagePosition(loopParams.instance);

  loopParams.postMessage(loopParams.panel, {
    type: 'streamChunk',
    stageId: testRunStage.id,
    chunk: `↻ runtime-replan：已插入 ${applied.insertedStageId}（${action.reason}）\n`,
  });
  postEngineActivity(loopParams.postMessage, loopParams.panel, {
    kind: trigger.kind === 'preflight-pytest-asyncio' ? 'preflight' : 'replan',
    stageId: testRunStage.id,
    text: `插入 ${applied.insertedStageId}（${trigger.kind}）`,
  });
  loopParams.logUserAction?.('runtime_replan', {
    trigger: trigger.kind,
    insertedStageId: applied.insertedStageId,
    insertIndex: applied.insertIndex,
    ...logContext,
  });
  loopParams.debugLog(testRunStage.id, 'runtime_replan_applied', attempt, {
    insertedStageId: applied.insertedStageId,
    insertIndex: applied.insertIndex,
    currentStageIndex: loopParams.instance.currentStageIndex,
    trigger: trigger.kind,
  });
  loopParams.scheduleSave();
  return 'replan';
}

/**
 * P3b：gate-repair 仍 block 时插入 runtime replan stage 并跳转游标。
 */
export function tryRuntimeReplanFromGateBlock(params: {
  loopParams: ExecuteNextStageLoopParams;
  testRunStage: Stage;
  block: GateResult;
  attempt: number;
}): RuntimeReplanGateOutcome {
  const { loopParams, testRunStage, block, attempt } = params;
  if (!readRuntimeReplanEnabled()) {
    return 'not-applied';
  }

  const trigger = buildGateRepairExhaustedTrigger(testRunStage.id, block);
  if (!trigger) {
    return 'not-applied';
  }

  const repair = parseGateRepairIssue(block);
  const writeTarget = repair ? resolveGateRepairWriteTarget(repair) : undefined;
  return executeRuntimeReplan({
    loopParams,
    testRunStage,
    trigger,
    attempt,
    gateRepairWriteTarget: writeTarget,
    logContext: { gateId: block.gateId },
  });
}

/**
 * P3c：test-run-preflight 缺 pytest-asyncio 时插入 pip replan stage。
 */
export function tryRuntimeReplanFromPreflightBlock(params: {
  loopParams: ExecuteNextStageLoopParams;
  testRunStage: Stage;
  block: GateResult;
  attempt: number;
}): RuntimeReplanGateOutcome {
  const { loopParams, testRunStage, block, attempt } = params;
  if (!readRuntimeReplanEnabled()) {
    return 'not-applied';
  }

  let trigger: RuntimeReplanTrigger | null = null;
  let preflightTag = '';
  if (isPreflightPytestAsyncioBlock(block)) {
    trigger = buildPreflightPytestAsyncioTrigger(testRunStage.id);
    preflightTag = 'pytest-asyncio';
  } else if (isPreflightConftestBlock(block)) {
    trigger = buildPreflightConftestTrigger(testRunStage.id);
    preflightTag = 'conftest';
  }
  if (!trigger) {
    return 'not-applied';
  }

  return executeRuntimeReplan({
    loopParams,
    testRunStage,
    trigger,
    attempt,
    logContext: { gateId: block.gateId, preflight: preflightTag },
  });
}

/**
 * P3d：fix_if_failed 达上限仍红时插入 fix replan stage。
 */
export function tryRuntimeReplanFromFixExhausted(params: {
  loopParams: ExecuteNextStageLoopParams;
  testRunStage: Stage;
  fixStage: Stage;
  attempt: number;
}): RuntimeReplanGateOutcome {
  const { loopParams, testRunStage, fixStage, attempt } = params;
  if (!readRuntimeReplanEnabled()) {
    return 'not-applied';
  }

  const testRunRt = loopParams.instance.stageRuntimes.find((rt) => rt.stageId === testRunStage.id);
  const trigger = buildFixExhaustedTrigger({
    testRunStageId: testRunStage.id,
    testRunRt,
  });
  if (!trigger) {
    return 'not-applied';
  }

  const writeTarget = resolveFixReplanWriteTarget(
    fixStage,
    testRunStage.id,
    loopParams.instance.definition.stages,
  );
  return executeRuntimeReplan({
    loopParams,
    testRunStage,
    trigger,
    attempt,
    gateRepairWriteTarget: writeTarget,
    logContext: { fixStageId: fixStage.id, trigger: 'fix-exhausted' },
  });
}
