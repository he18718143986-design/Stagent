import { syncDagCurrentStageIndex } from '../../WorkflowDag';
import { executeStageStep } from '../../WorkflowStageStep';
import type { ExecuteNextStageLoopParams } from '../../WorkflowExecutorTypes';
import {
  DEBUG_EVENT_DAG_PARALLEL_WAVE,
  DEBUG_EVENT_DAG_PARALLEL_WAVE_COMPLETE,
} from '../../DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from '../../workflow/WorkflowLevelIds';

export async function runDagParallelWave(
  params: ExecuteNextStageLoopParams,
  batch: number[],
  maxParallel: number,
): Promise<'continue' | 'exit'> {
  const { instance } = params;
  const { definition } = instance;
  const stageIds = batch.map((i) => definition.stages[i].id);
  const waveIndex = params.onDagParallelWaveStart?.(stageIds);
  params.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_DAG_PARALLEL_WAVE, 0, { mode: 'dag', maxParallel, stageIds, waveIndex });
  const outcomes = await Promise.all(batch.map((idx) => executeStageStep(params, idx)));
  if (waveIndex !== undefined) {
    const payload = params.onDagParallelWaveComplete?.(waveIndex) ?? {};
    params.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_DAG_PARALLEL_WAVE_COMPLETE, 0, payload);
  }
  params.scheduleSave();
  params.persistMilestone?.();
  if (outcomes.some((o) => o === 'failed') || instance.status === 'failed') {
    return 'exit';
  }
  if (outcomes.some((o) => o === 'halt')) {
    syncDagCurrentStageIndex(instance);
    return 'exit';
  }
  if (outcomes.some((o) => o === 'replan')) {
    syncDagCurrentStageIndex(instance);
    return 'continue';
  }
  return 'continue';
}

export async function runDagSingleStep(
  params: ExecuteNextStageLoopParams,
  stageIndex: number,
): Promise<'continue' | 'exit'> {
  const outcome = await executeStageStep(params, stageIndex);
  params.scheduleSave();
  if (outcome === 'failed' || params.instance.status === 'failed') {
    return 'exit';
  }
  if (outcome === 'halt') {
    syncDagCurrentStageIndex(params.instance);
    return 'exit';
  }
  if (outcome === 'replan') {
    syncDagCurrentStageIndex(params.instance);
    return 'continue';
  }
  return 'continue';
}
