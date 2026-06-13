import type { Stage } from './WorkflowDefinition';
import type { ExecuteNextStageLoopParams } from './WorkflowExecutorTypes';
import { runPreGateRegistry, type PreGateOutcome } from './PreGateRegistry';

export { failWorkflowStageFromGate } from './WorkflowStageGateFailure';
export type { PreGateOutcome } from './PreGateRegistry';

export async function applyPreStageQualityGates(
  params: ExecuteNextStageLoopParams,
  stage: Stage,
  stageIndex: number,
  when: 'always' | 'before-impl' | 'before-test-run',
  attempt: number,
): Promise<PreGateOutcome> {
  return runPreGateRegistry(params, stage, stageIndex, when, attempt);
}
