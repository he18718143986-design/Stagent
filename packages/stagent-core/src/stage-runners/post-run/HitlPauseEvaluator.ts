import type { Stage } from '../../WorkflowDefinition';
import { isLlmTextTool } from '../../workflow/StageToolKinds';
import type { ConfidenceResult } from '../../ConfidenceScorer';
import { CONFIDENCE_OUTPUT_KEY } from '../../ConfidenceScorer';
import { buildHITLPolicy, shouldPauseAfterStage } from '../../AdaptiveHITLPolicy';
import type { ExecuteNextStageLoopParams } from '../../WorkflowExecutorTypes';
import { DEBUG_EVENT_HITL_EVALUATED } from '../../DebugLogEvents';

export interface HitlPauseInput {
  params: ExecuteNextStageLoopParams;
  stage: Stage;
  runtime: import('../../WorkflowDefinition').StageRuntime;
  effectivePauseAfter: boolean;
  attempt: number;
  contractNode: boolean;
}

export function evaluateHitlPause(input: HitlPauseInput): boolean {
  const { params, stage, runtime, effectivePauseAfter, attempt, contractNode } = input;
  const { debugLog, hitlPolicy, confidencePauseThreshold } = params;
  const policy = hitlPolicy ?? buildHITLPolicy({ confidencePauseThreshold });
  const confidenceResult = runtime.outputs[CONFIDENCE_OUTPUT_KEY] as ConfidenceResult | undefined;
  if (stage.meta?.executionMode === 'deterministic') {
    return false;
  }
  const shouldPause =
    isLlmTextTool(stage.tool) && confidenceResult && hitlPolicy
      ? shouldPauseAfterStage(stage, runtime, confidenceResult, policy, {
          isContractNode: contractNode,
        })
      : effectivePauseAfter;
  if (isLlmTextTool(stage.tool) && confidenceResult && hitlPolicy) {
    debugLog(stage.id, DEBUG_EVENT_HITL_EVALUATED, attempt, {
      shouldPause,
      confidence: confidenceResult.score,
      pauseThreshold: policy.confidencePauseThreshold,
      contractNode,
      contractNodePauseThreshold: policy.contractNodePauseThreshold,
    });
  }
  return shouldPause;
}
