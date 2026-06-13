import type { FileWriteConfig, StageRuntime, WorkflowInstance } from '../WorkflowDefinition';

export function findStageRuntimeByOutputKey(instance: WorkflowInstance, outputKey: string): StageRuntime | undefined {
  for (let i = 0; i < instance.definition.stages.length; i++) {
    const rt = instance.stageRuntimes[i];
    if (rt?.outputs[outputKey] !== undefined) {
      return rt;
    }
  }
  return undefined;
}

export function findFileWriteSourceRuntime(instance: WorkflowInstance, cfg: FileWriteConfig): StageRuntime | undefined {
  if (cfg.sourceStageId?.trim()) {
    const idx = instance.definition.stages.findIndex((s) => s.id === cfg.sourceStageId);
    if (idx < 0) {
      return undefined;
    }
    return instance.stageRuntimes[idx];
  }
  return findStageRuntimeByOutputKey(instance, cfg.sourceOutputKey);
}
