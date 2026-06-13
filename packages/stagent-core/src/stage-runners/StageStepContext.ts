import type { ExecuteNextStageLoopParams } from '../WorkflowExecutorTypes';
import type { Stage, StageRuntime, WorkflowInstance } from '../WorkflowDefinition';
import type { PanelLike } from '../WorkflowExecutorTypes';

/** 单阶段执行上下文（从 loop params + index 派生）。 */
export interface StageStepContext {
  params: ExecuteNextStageLoopParams;
  stageIndex: number;
  instance: WorkflowInstance;
  stage: Stage;
  runtime: StageRuntime;
  panel: PanelLike;
}

export function buildStageStepContext(
  params: ExecuteNextStageLoopParams,
  stageIndex: number,
): StageStepContext {
  const { instance } = params;
  return {
    params,
    stageIndex,
    instance,
    stage: instance.definition.stages[stageIndex],
    runtime: instance.stageRuntimes[stageIndex],
    panel: params.panel,
  };
}
