import type { WorkflowDefinition } from './WorkflowDefinition';
import { formatWorkflowDependencyCycleError } from './WorkflowDag';

export function validateWorkflowStructure(wf: WorkflowDefinition): string[] {
  const errors: string[] = [];
  if (wf.version !== '2.0') {
    errors.push(`WorkflowDefinition.version 必须为 '2.0'，当前为 ${JSON.stringify(wf.version)}`);
  }
  if (!wf.stages?.length) {
    errors.push('stages 不能为空');
  }
  const cycleErr = formatWorkflowDependencyCycleError(wf.stages ?? []);
  if (cycleErr) {
    errors.push(cycleErr);
  }
  return errors;
}
