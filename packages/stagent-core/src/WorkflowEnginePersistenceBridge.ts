import { globalStateKeyForInstance } from './instance/InstanceGlobalStateKeys';
import { voidGlobalStateUpdate } from './instance/GlobalStateSafeUpdate';
import type { WorkflowInstance } from './WorkflowDefinition';
import { persistInstanceFile, persistInstanceFileAsync } from './WorkflowPersistence';
import { bumpInstancePersistRevision } from './WorkflowStateEnvelope';
import {
  instanceIndexEntryFromWorkflow,
  upsertInstanceIndexEntry,
  removeInstanceIndexEntry,
} from './WorkflowInstanceIndex';

/**
 * M30-F1：WorkflowEngine 持久化桥接薄层（零行为变化拆分）。
 * 引擎 scheduleSave / persistMilestone 委托此模块，便于后续再拆 DAG / Webview 桥。
 */

export interface PersistenceBridgeDeps {
  workspaceFolderPath: () => string | undefined;
  globalStorageFsPath: string;
  updateGlobalState: (key: string, value: WorkflowInstance) => Promise<void>;
  warn: (message: string) => void;
  degraded: (reason: string, context?: Record<string, unknown>) => void;
  notifyInstancesChanged: () => void;
  /** 磁盘已写入但 globalState 最终失败时（侧栏索引可能陈旧） */
  onGlobalStateFailed?: (instanceKey: string) => void;
  /** 测试注入：覆盖默认磁盘写盘 */
  persistInstanceAsync?: typeof persistInstanceFileAsync;
  persistInstanceSync?: typeof persistInstanceFile;
}

function globalStateFailureOptions(
  deps: PersistenceBridgeDeps,
  instanceKey: string,
): { onFailure?: (context: string, err: unknown) => void } {
  if (!deps.onGlobalStateFailed) {
    return {};
  }
  return {
    onFailure: () => deps.onGlobalStateFailed!(instanceKey),
  };
}

export async function flushInstanceSaveAsync(
  deps: PersistenceBridgeDeps,
  instanceKey: string,
  instance: WorkflowInstance,
): Promise<void> {
  bumpInstancePersistRevision(instance);
  const persistAsync = deps.persistInstanceAsync ?? persistInstanceFileAsync;
  try {
    await persistAsync(instanceKey, instance, deps.workspaceFolderPath(), deps.globalStorageFsPath);
  } catch (e) {
    deps.degraded('state_file_persist_failed', {
      instanceKey,
      err: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  voidGlobalStateUpdate(
    () => deps.updateGlobalState(globalStateKeyForInstance(instanceKey), instance),
    deps.warn,
    globalStateKeyForInstance(instanceKey),
    globalStateFailureOptions(deps, instanceKey),
  );
  upsertInstanceIndexEntry(
    deps.workspaceFolderPath(),
    instanceIndexEntryFromWorkflow(instanceKey, instance),
  );
  deps.notifyInstancesChanged();
}

export function persistInstanceSnapshotSync(
  deps: PersistenceBridgeDeps,
  instanceKey: string,
  instance: WorkflowInstance,
): void {
  bumpInstancePersistRevision(instance);
  const persistSync = deps.persistInstanceSync ?? persistInstanceFile;
  try {
    persistSync(instanceKey, instance, deps.workspaceFolderPath(), deps.globalStorageFsPath);
  } catch (e) {
    deps.degraded('persist_instance_snapshot_failed', {
      instanceKey,
      err: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  voidGlobalStateUpdate(
    () => deps.updateGlobalState(globalStateKeyForInstance(instanceKey), instance),
    deps.warn,
    globalStateKeyForInstance(instanceKey),
    globalStateFailureOptions(deps, instanceKey),
  );
  upsertInstanceIndexEntry(
    deps.workspaceFolderPath(),
    instanceIndexEntryFromWorkflow(instanceKey, instance),
  );
  deps.notifyInstancesChanged();
}
