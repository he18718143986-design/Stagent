import type { WebviewPanel } from '../platform/HostTypes';
import type { WorkflowInstance } from '../WorkflowDefinition';
import { canSwitchActiveInstance } from '../ActiveInstanceGuard';
import { DEBUG_EVENT_INSTANCE_SWITCH_BLOCKED } from '../DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from '../workflow/WorkflowLevelIds';
import { pushExecutionRecoveryUi } from './pushRecoveryUi';
import type { ResumeCoordinatorHost } from './types';

export interface TryActivateInstanceOptions {
  /** 激活成功后推送 execution recovery UI（resumeInstance 自行推送时应为 false）。 */
  pushRecoveryUi?: boolean;
}

/** #5：切换活跃实例；执行中禁止跨实例切换，切换前 flush 旧实例。 */
export function tryActivateInstance(
  host: ResumeCoordinatorHost,
  targetKey: string,
  loaded: WorkflowInstance,
  panel: WebviewPanel,
  options?: TryActivateInstanceOptions,
): { ok: true } | { ok: false; reason: string } {
  const decision = canSwitchActiveInstance({
    currentKey: host.getCurrentInstanceKey(),
    targetKey,
    executionDepth: host.getExecutionDepth(),
  });
  if (!decision.ok) {
    host.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_INSTANCE_SWITCH_BLOCKED, 0, {
      reason: decision.reason,
      targetInstanceKey: targetKey,
      activeInstanceKey: host.getCurrentInstanceKey(),
    });
    host.postMessage(panel, {
      type: 'instanceSwitchBlocked',
      reason: decision.reason,
      targetInstanceKey: targetKey,
      activeInstanceKey: host.getCurrentInstanceKey(),
    });
    return { ok: false, reason: decision.reason };
  }
  if (host.getCurrentInstanceKey() && host.getCurrentInstanceKey() !== targetKey && host.getInstance()) {
    host.clearSaveTimer();
    host.persistInstanceSnapshot(host.getCurrentInstanceKey()!, host.getInstance()!);
  }
  if (host.getCurrentInstanceKey() !== targetKey) {
    host.clearExperiencePersistedFlag();
  }
  host.setInstance(loaded);
  host.setCurrentInstanceKey(targetKey);
  if (options?.pushRecoveryUi && loaded.status !== 'idle') {
    pushExecutionRecoveryUi(host, panel, loaded, targetKey);
  }
  return { ok: true };
}
