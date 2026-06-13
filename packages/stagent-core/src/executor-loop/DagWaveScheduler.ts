import { DEBUG_EVENT_DAG_SCHEDULER_EXIT } from '../DebugLogEvents';
import { pickDagExecutionBatch } from '../WorkflowDag';
import type { ExecuteNextStageLoopParams } from '../WorkflowExecutorTypes';
import { WORKFLOW_LEVEL_STAGE_ID } from '../workflow/WorkflowLevelIds';
import {
  completeDagWorkflow,
  failDagStuckPending,
  runDagParallelWave,
  runDagSingleStep,
} from './dagWaveHelpers';

export async function executeNextStageLoopDag(params: ExecuteNextStageLoopParams): Promise<void> {
  const { instance } = params;
  const { definition, stageRuntimes } = instance;
  const maxParallel = params.dagMaxParallelism ?? 1;

  while (true) {
    const pausedIdx = stageRuntimes.findIndex((rt) => rt.status === 'paused' || rt.status === 'waiting-questions');
    if (pausedIdx >= 0) {
      instance.currentStageIndex = pausedIdx;
      params.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_DAG_SCHEDULER_EXIT, 0, {
        reason: 'paused-or-waiting-questions',
        stageIndex: pausedIdx,
      });
      return;
    }

    const runningIdx = stageRuntimes.findIndex((rt) => rt.status === 'running' || rt.status === 'retrying');
    if (runningIdx >= 0) {
      instance.currentStageIndex = runningIdx;
      params.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_DAG_SCHEDULER_EXIT, 0, {
        reason: 'running-or-retrying',
        stageIndex: runningIdx,
      });
      return;
    }

    const allTerminal = stageRuntimes.every((rt) => rt.status === 'done' || rt.status === 'skipped');
    if (allTerminal) {
      params.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_DAG_SCHEDULER_EXIT, 0, { reason: 'all-terminal' });
      await completeDagWorkflow(params, maxParallel);
      return;
    }

    const batch = pickDagExecutionBatch(definition.stages, stageRuntimes, maxParallel);
    if (batch.length === 0) {
      params.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_DAG_SCHEDULER_EXIT, 0, { reason: 'stuck-pending' });
      failDagStuckPending(params);
      return;
    }

    instance.currentStageIndex = batch[0];
    if (batch.length === 1) {
      if ((await runDagSingleStep(params, batch[0])) === 'exit') {
        return;
      }
      continue;
    }

    if ((await runDagParallelWave(params, batch, maxParallel)) === 'exit') {
      return;
    }
  }
}
