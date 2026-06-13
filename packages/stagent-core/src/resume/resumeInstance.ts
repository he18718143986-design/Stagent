import * as crypto from 'crypto';
import type { WebviewPanel } from '../platform/HostTypes';
import { syncInstanceStagePosition } from '../WorkflowStagePosition';
import { tryActivateInstance } from './activateInstance';
import { continueInterruptedRunIfNeeded } from './continueInterruptedRun';
import { pushExecutionRecoveryUi, pushIdleRestoredWorkflow } from './pushRecoveryUi';
import type { ResumeCoordinatorHost } from './types';
import { DEBUG_EVENT_RESUME_FAILED, DEBUG_EVENT_RUN_RESUME } from '../DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from '../workflow/WorkflowLevelIds';

export async function resumeInstance(
  host: ResumeCoordinatorHost,
  instanceKey: string,
  panel: WebviewPanel,
): Promise<boolean> {
  host.bindPanel(panel);
  const loaded = host.loadInstanceByKey(instanceKey);
  if (!loaded) {
    host.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_RESUME_FAILED, 0, {
      reason: 'instance-not-found',
      instanceKey,
    });
    return false;
  }
  const activated = tryActivateInstance(host, instanceKey, loaded, panel);
  if (!activated.ok) {
    host.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_RESUME_FAILED, 0, {
      reason: activated.reason ?? 'activate-failed',
      instanceKey,
    });
    return false;
  }
  const instance = host.getInstance()!;
  if (!instance.traceId) {
    instance.traceId = `trace_${crypto.randomUUID()}`;
  }
  if (!instance.taskDir) {
    instance.taskDir = host.getDefaultTaskDir(instanceKey);
  }
  syncInstanceStagePosition(instance);
  host.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_RUN_RESUME, 0, {
    workflowId: instance.definition.id,
    status: instance.status,
  });

  if (instance.status === 'idle') {
    pushIdleRestoredWorkflow(host, panel, instance, instanceKey);
    host.scheduleSave();
    return true;
  }

  pushExecutionRecoveryUi(host, panel, instance, instanceKey);
  await continueInterruptedRunIfNeeded(host, panel, instance);

  host.scheduleSave();
  return true;
}
