import type { Stage, StageRuntime, WorkflowInstance } from '../WorkflowDefinition';

export interface HitlStageBinding {
  instance: WorkflowInstance;
  idx: number;
  stage: Stage;
  rt: StageRuntime;
}

export function findHitlStage(instance: WorkflowInstance, stageId: string): HitlStageBinding | null {
  const idx = instance.definition.stages.findIndex((s) => s.id === stageId);
  if (idx < 0) {
    return null;
  }
  return {
    instance,
    idx,
    stage: instance.definition.stages[idx]!,
    rt: instance.stageRuntimes[idx]!,
  };
}

/** idx 有效且 idx === currentStageIndex 且 rt.status === 'paused' */
export function requirePausedStageAtCurrent(
  instance: WorkflowInstance,
  stageId: string,
): HitlStageBinding | null {
  const binding = findHitlStage(instance, stageId);
  if (!binding) {
    return null;
  }
  if (binding.idx !== instance.currentStageIndex || binding.rt.status !== 'paused') {
    return null;
  }
  return binding;
}
