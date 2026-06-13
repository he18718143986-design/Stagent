import type { HostPanel } from './platform/HostTypes';
import {
  DECISION_STAGE_INVARIANT_I1_MSG,
  ensureDecisionStageOutput,
  validateDecisionStageInvariants,
} from './workflow/DecisionStageShape';
import type { BackendMessage, WorkflowDefinition } from './WorkflowDefinition';
import { emitStageError, ERROR_TYPE_INVARIANT_VIOLATION, invariantStageError } from './WorkflowStageErrorHelpers';
import { validateGeneratedWorkflow } from './WorkflowValidation';
import { reapplyDiskBootstrap } from './WorkflowEngineHelpers';

export function validateStartWorkflowPreconditions(
  host: {
    normalizeWorkflow: (wf: WorkflowDefinition, userInput: string, taskType: string) => WorkflowDefinition;
    postMessage: (panel: HostPanel, msg: BackendMessage) => void;
  },
  panel: HostPanel,
  workflowOverride: WorkflowDefinition,
): WorkflowDefinition | null {
  let wf = reapplyDiskBootstrap(workflowOverride);
  wf = host.normalizeWorkflow(wf, wf.meta?.userInput ?? '', wf.meta?.taskType ?? 'software');

  const invErrors = validateGeneratedWorkflow(wf);
  if (invErrors.length > 0) {
    host.postMessage(panel, {
      type: 'workflowFailed',
      reason: invErrors.join('; '),
      errorType: ERROR_TYPE_INVARIANT_VIOLATION,
    });
    return null;
  }

  for (const stage of wf.stages) {
    const invErrorsForStage = validateDecisionStageInvariants(stage);
    const i1Error = invErrorsForStage.find((e) => e.includes('I-1'));
    if (i1Error) {
      emitStageError(
        panel,
        (p, msg) => host.postMessage(p as HostPanel, msg),
        undefined,
        invariantStageError(stage.id, DECISION_STAGE_INVARIANT_I1_MSG),
      );
      host.postMessage(panel, {
        type: 'workflowFailed',
        reason: 'generated_workflow_failed_invariant_check',
        errorType: ERROR_TYPE_INVARIANT_VIOLATION,
        stageId: stage.id,
      });
      return null;
    }
    ensureDecisionStageOutput(stage);
  }

  return wf;
}
