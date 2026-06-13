import type { WorkflowDefinition } from '../WorkflowDefinition';
import { splitBundledVenvPipImportCommands } from '../TestRunCommandNormalize';
import { isPythonOnlyWorkflow } from '../python-bootstrap/pythonStackDetect';

/** startExecution / normalize 入场：拆分旧实例合并 venv 链（不改 wf-state 历史 id）。 */
export function applyPythonWorkflowRepairs(wf: WorkflowDefinition): WorkflowDefinition {
  if (!isPythonOnlyWorkflow(wf)) {
    return wf;
  }
  splitBundledVenvPipImportCommands(wf);
  return wf;
}
