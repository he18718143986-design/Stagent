import type { Stage, StageRuntime } from '../WorkflowDefinition';

export function createPendingRuntime(stage: Stage): StageRuntime {
  return {
    stageId: stage.id,
    status: 'pending',
    outputs: {},
    retryCount: 0,
  };
}
