import type { Stage } from '../../WorkflowDefinition';
import { CONFIDENCE_OUTPUT_KEY } from '../../ConfidenceScorer';
import type { QualityScore } from '../../OutputQualityScorer';
import { QUALITY_SCORE_OUTPUT_KEY } from '../../OutputQualityScorer';
import type { ExecuteNextStageLoopParams } from '../../WorkflowExecutorTypes';
import { DEBUG_EVENT_STAGE_END } from '../../DebugLogEvents';

export function logStageEndMeta(
  params: ExecuteNextStageLoopParams,
  stage: Stage,
  runtime: import('../../WorkflowDefinition').StageRuntime,
  outKey: string,
  attempt: number,
  status: string,
): void {
  const qualityMeta = runtime.outputs[QUALITY_SCORE_OUTPUT_KEY] as QualityScore | undefined;
  const confidenceMeta = runtime.outputs[CONFIDENCE_OUTPUT_KEY] as { score?: number; level?: string } | undefined;
  params.debugLog(stage.id, DEBUG_EVENT_STAGE_END, attempt, {
    status,
    outputKey: outKey,
    ...(qualityMeta?.overall !== undefined ? { qualityOverall: qualityMeta.overall } : {}),
    ...(confidenceMeta?.score !== undefined
      ? { confidenceScore: confidenceMeta.score, confidenceLevel: confidenceMeta.level }
      : {}),
  });
}
