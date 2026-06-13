import type { WebviewPanel } from './platform/HostTypes';
import type { WorkflowDefinition } from './WorkflowDefinition';
import { buildSessionSyncedMessage } from './InstanceSession';
import type { StartExecutionHost } from './WorkflowStartCoordinator';

export async function kickoffFirstWorkflowStage(
  host: StartExecutionHost,
  panel: WebviewPanel,
  wf: WorkflowDefinition,
  instanceId: string,
  taskDir: string,
): Promise<void> {
  host.writeProcessDocs(wf, taskDir);
  host.persistMilestone();
  host.scheduleSave();
  host.postMessage(panel, buildSessionSyncedMessage(instanceId));
  host.postMessage(panel, {
    type: 'instanceKeySynced',
    instanceKey: instanceId,
  });
  await host.executeNextStage(panel);
}
