import { runPreStageQualityGates } from './QualityGateRunner';
import { debugEventForQualityGate } from './DebugLogEvents';
import { GATE_ID_RED_GREEN_PRE_IMPL } from './QualityGateIds';
import type { GateResult } from './QualityGate';
import type { Stage } from './WorkflowDefinition';
import type { ExecuteNextStageLoopParams } from './WorkflowExecutorTypes';
import { failWorkflowStageFromGate } from './WorkflowStageGateFailure';
import { isRepairableGateBlock } from './gate-repair/GateRepairRouter';
import { tryGateAutoRepair } from './gate-repair/runGateAutoRepair';
import {
  tryRuntimeReplanFromGateBlock,
  tryRuntimeReplanFromPreflightBlock,
} from './runtime-replan/tryRuntimeReplanFromGate';
import { postEngineActivity } from './engine-activity/postEngineActivity';
import { readGateAutoRepairEnabled } from './settings/readers/exec';
import { readContractRuntimePreflightV2Enabled } from './settings/readers/contract';
import { runRuntimePreflight, postWorkflowEscalation } from './runtime-preflight';
import { applyRuntimeReplan } from './runtime-replan/applyRuntimeReplan';
import { planDeterministicReplan } from './runtime-replan/planDeterministicReplan';
import { syncInstanceStagePosition } from './WorkflowStagePosition';

export type PreGateWhen = 'always' | 'before-impl' | 'before-test-run';
export type PreGateOutcome = 'continue' | 'failed' | 'replan';

async function evaluatePreStageGates(
  params: ExecuteNextStageLoopParams,
  stage: Stage,
  stageIndex: number,
  when: PreGateWhen,
  attempt: number,
): Promise<{ outcome: 'continue' | 'failed'; block?: GateResult }> {
  if (!params.qualityGateExecutionHost) {
    return { outcome: 'continue' };
  }
  const runtime = params.instance.stageRuntimes[stageIndex];
  const result = await runPreStageQualityGates(
    {
      phase: 'pre-stage',
      when,
      workflow: params.instance.definition,
      stage,
      stageIndex,
      stageRuntime: runtime,
      instance: params.instance,
      instanceKey: params.currentInstanceKey,
      executionHost: params.qualityGateExecutionHost,
    },
    when,
  );
  for (const w of result.summary.warnings) {
    params.debugLog(stage.id, debugEventForQualityGate(w.gateId), attempt, { messages: w.messages });
    if (when === 'before-impl' && w.gateId === GATE_ID_RED_GREEN_PRE_IMPL) {
      params.postMessage(params.panel, {
        type: 'streamChunk',
        stageId: stage.id,
        chunk: `⚠️ 红绿门（I-25）：${w.messages.join('; ')}\n`,
      });
    }
  }
  if (result.outcome === 'failed') {
    return { outcome: 'failed', block: result.summary.blocks[0] };
  }
  return { outcome: 'continue' };
}

async function runQualityGateHostPreGate(
  params: ExecuteNextStageLoopParams,
  stage: Stage,
  stageIndex: number,
  when: PreGateWhen,
  attempt: number,
  allowGateRepair: boolean,
): Promise<PreGateOutcome> {
  const evaluation = await evaluatePreStageGates(params, stage, stageIndex, when, attempt);
  if (evaluation.outcome !== 'failed' || !evaluation.block) {
    return 'continue';
  }

  let block = evaluation.block;
  postEngineActivity(params.postMessage, params.panel, {
    kind: 'gate',
    stageId: stage.id,
    text: `pre-gate block：${block.gateId}`,
  });
  if (when === 'before-test-run') {
    const preflightReplan = tryRuntimeReplanFromPreflightBlock({
      loopParams: params,
      testRunStage: stage,
      block,
      attempt,
    });
    if (preflightReplan === 'replan') {
      return 'replan';
    }
  }

  if (allowGateRepair && when === 'before-test-run' && isRepairableGateBlock(block.gateId)) {
    if (readGateAutoRepairEnabled()) {
      const repaired = await tryGateAutoRepair({
        loopParams: params,
        testRunStage: stage,
        stageIndex,
        block,
        attempt,
      });
      if (repaired) {
        const retry = await evaluatePreStageGates(params, stage, stageIndex, when, attempt);
        if (retry.outcome === 'continue') {
          params.debugLog(stage.id, 'gate_auto_repair_passed', attempt, { gateId: block.gateId });
          postEngineActivity(params.postMessage, params.panel, {
            kind: 'gate',
            stageId: stage.id,
            text: `gate-repair 已通过 ${block.gateId}`,
          });
          return 'continue';
        }
        if (retry.block) {
          block = retry.block;
        }
      }
    }
    const replan = tryRuntimeReplanFromGateBlock({
      loopParams: params,
      testRunStage: stage,
      block,
      attempt,
    });
    if (replan === 'replan') {
      return 'replan';
    }
  }

  const reason = block.messages.join('; ') ?? 'quality gate blocked';
  return failWorkflowStageFromGate(
    params,
    stage,
    stageIndex,
    block.gateId === GATE_ID_RED_GREEN_PRE_IMPL ? `红绿门（I-25）：${reason}` : reason,
  );
}

async function runContractRuntimePreflight(
  params: ExecuteNextStageLoopParams,
  stage: Stage,
  stageIndex: number,
  when: PreGateWhen,
  attempt: number,
): Promise<PreGateOutcome> {
  if (!readContractRuntimePreflightV2Enabled()) {
    return 'continue';
  }
  const whenMapped = when === 'before-impl' || when === 'before-test-run' ? when : null;
  if (!whenMapped) {
    return 'continue';
  }

  const outcome = runRuntimePreflight({
    instance: params.instance,
    stage,
    when: whenMapped,
  });

  if (outcome.action === 'continue' || outcome.action === 'bootstrap') {
    return 'continue';
  }

  if (outcome.action === 'replan') {
    const action = planDeterministicReplan({
      trigger: outcome.trigger,
      instance: params.instance,
    });
    if (!action) {
      return 'continue';
    }
    const applied = applyRuntimeReplan(params.instance, action);
    if (!applied.ok) {
      params.debugLog(stage.id, 'runtime_preflight_replan_skipped', attempt, {
        reason: applied.reason,
        detail: applied.detail,
      });
      return 'continue';
    }
    params.instance = applied.instance;
    syncInstanceStagePosition(params.instance);
    params.scheduleSave();
    return 'replan';
  }

  if (outcome.action === 'reopen_decision') {
    postWorkflowEscalation(params.postMessage, params.panel, {
      stageId: stage.id,
      issues: [outcome.reason],
      reopenDecisionStageId: outcome.stageId,
    });
    return failWorkflowStageFromGate(params, stage, stageIndex, outcome.reason);
  }

  if (outcome.action === 'escalate_confirm') {
    postWorkflowEscalation(params.postMessage, params.panel, {
      stageId: stage.id,
      issues: outcome.issues,
    });
    return failWorkflowStageFromGate(params, stage, stageIndex, outcome.issues.join('; '));
  }

  if (outcome.action === 'failed') {
    return failWorkflowStageFromGate(params, stage, stageIndex, outcome.messages.join('; '));
  }

  return 'continue';
}

const preGateRegistry: Record<PreGateWhen, Array<typeof runQualityGateHostPreGate | typeof runContractRuntimePreflight>> = {
  always: [runContractRuntimePreflight, runQualityGateHostPreGate],
  'before-impl': [runContractRuntimePreflight, runQualityGateHostPreGate],
  'before-test-run': [runContractRuntimePreflight, runQualityGateHostPreGate],
};

export async function runPreGateRegistry(
  params: ExecuteNextStageLoopParams,
  stage: Stage,
  stageIndex: number,
  when: PreGateWhen,
  attempt: number,
): Promise<PreGateOutcome> {
  for (const handler of preGateRegistry[when]) {
    const outcome =
      handler === runContractRuntimePreflight
        ? await runContractRuntimePreflight(params, stage, stageIndex, when, attempt)
        : await handler(params, stage, stageIndex, when, attempt, true);
    if (outcome === 'failed' || outcome === 'replan') {
      return outcome;
    }
  }
  return 'continue';
}
