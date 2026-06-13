import type { WorkflowDefinition } from '../../WorkflowDefinition';
import type { Stage } from '../../WorkflowDefinition';
import { isValidKnownToolStage, validateToolPresence } from './common';
import { validateCodeRunnerToolConfig } from './codeRunner';
import { validateFileIoToolConfig } from './fileIo';

export { isValidKnownToolStage } from './common';

export function validateToolConfig(stage: Stage, wf: WorkflowDefinition, stageIndex: number): string[] {
  const presence = validateToolPresence(stage);
  if (presence.length > 0) {
    return presence;
  }
  return [
    ...validateFileIoToolConfig(stage, wf),
    ...validateCodeRunnerToolConfig(stage, wf, stageIndex),
  ];
}
