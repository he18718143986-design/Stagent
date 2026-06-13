import type { Stage } from './WorkflowDefinition';
import { failWorkflowStage, invariantStageError } from './WorkflowStageErrorHelpers';
import type { ExecuteNextStageLoopParams } from './WorkflowExecutorTypes';

export function failWorkflowStageFromGate(
  params: ExecuteNextStageLoopParams,
  stage: Stage,
  stageIndex: number,
  error: string,
): 'failed' {
  const runtime = params.instance.stageRuntimes[stageIndex];
  failWorkflowStage(
    params.panel,
    params.postMessage,
    runtime,
    params.instance,
    invariantStageError(stage.id, error),
    params.scheduleSave,
  );
  return 'failed';
}
