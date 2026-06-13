import type { WebviewPanel } from '../platform/HostTypes';
import { showStartErrorToast } from '../adapters/showStartErrorToast';
import { uiMsg } from '../l10n/uiStrings';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import type { FrontloadDecisionResolution } from '../decision-frontload/DecisionFrontloadTypes';
import { kickoffFirstWorkflowStage } from '../KickoffFirstStage';
import { bootstrapWorkflowRuntime } from '../RuntimeBootstrap';
import { validateStartWorkflowPreconditions } from '../StartPreconditions';
import type { StartExecutionHost } from './types';

export type { StartExecutionHost } from './types';
export { writeWorkflowProcessDocs } from './writeProcessDocs';

export async function startWorkflowExecution(
  host: StartExecutionHost,
  panel: WebviewPanel,
  workflowOverride?: WorkflowDefinition,
  instanceKey?: string,
  frontloadResolutions?: FrontloadDecisionResolution[],
): Promise<void> {
  host.bindPanel(panel);
  if (!workflowOverride) {
    showStartErrorToast(uiMsg('stagent.error.missingWorkflowDefinition'));
    return;
  }

  const wf = validateStartWorkflowPreconditions(host, panel, workflowOverride);
  if (!wf) {
    return;
  }

  const boot = bootstrapWorkflowRuntime(host, panel, wf, instanceKey, frontloadResolutions);
  if (!boot.ok) {
    return;
  }

  await kickoffFirstWorkflowStage(host, panel, boot.wf, boot.instanceId, boot.taskDir);
}
