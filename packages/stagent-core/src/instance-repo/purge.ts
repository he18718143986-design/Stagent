/**
 * globalState purge 原语（read/mutate 共用，单列以避免循环依赖，1.3）。
 */
import { voidGlobalStateUpdate } from '../instance/GlobalStateSafeUpdate';
import type { InstanceRepositoryContext } from './context';

export function purgeInstanceGlobalState(
  ctx: InstanceRepositoryContext,
  instanceKey: string,
  reason: string,
): void {
  voidGlobalStateUpdate(() => ctx.updateGlobalState(instanceKey, undefined), ctx.warn, instanceKey);
  ctx.warn(`instance_purged_global_state key=${instanceKey} reason=${reason}`);
  if (ctx.active?.key === instanceKey) {
    ctx.onActivePurged?.(instanceKey);
  }
  ctx.notifyInstancesChanged();
}
