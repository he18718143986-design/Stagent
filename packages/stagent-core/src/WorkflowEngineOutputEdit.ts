import type { WorkflowInstance } from './WorkflowDefinition';
import type { WorkflowInstanceManager } from './WorkflowInstanceManager';
import type { WorkflowEngineDiagnostics } from './WorkflowEngineDiagnostics';

export function applyOutputEdit(
  instances: WorkflowInstanceManager,
  diagnostics: WorkflowEngineDiagnostics,
  stageId: string,
  outputKey: string,
  newContent: unknown,
): void {
  const inst = instances.lifecycle.getInstance();
  if (!inst) {
    return;
  }
  const idx = inst.definition.stages.findIndex((s) => s.id === stageId);
  if (idx < 0) {
    return;
  }
  inst.stageRuntimes[idx].outputs[outputKey] = newContent;
  diagnostics.logUserAction('edit_output', { stageId, outputKey });
  instances.persistence.scheduleSave();
}

export type { WorkflowInstance };
