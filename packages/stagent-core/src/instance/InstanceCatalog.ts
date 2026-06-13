import type { DeleteScope } from '../WorkflowDeletePlan';
import type { WorkflowInstance } from '../WorkflowDefinition';
import {
  deleteInstanceRecord,
  listKnownInstanceKeys,
  loadInstanceByKeyForList,
  pruneStaleGlobalInstances as pruneStaleGlobalInstancesFromRepo,
  resolveInstanceForList,
  resolveReuseInstance as resolveReuseInstanceFromRepo,
} from '../WorkflowInstanceRepository';
import {
  buildTaskListItem,
  getRecoverableInstanceKeysFromGlobalStateKeys,
  type TaskListItem,
} from '../WorkflowInstanceQuery';
import type { InstancePersistenceOps } from './InstancePersistenceOps';
import type { InstanceLifecycle } from './InstanceLifecycle';

export class InstanceCatalog {
  constructor(
    private readonly lifecycle: InstanceLifecycle,
    private readonly persistence: InstancePersistenceOps,
  ) {}

  pruneStaleGlobalInstances(): void {
    pruneStaleGlobalInstancesFromRepo(this.persistence.instanceRepoContext());
  }

  getRecoverableInstanceKeys(): string[] {
    const ctx = this.persistence.instanceRepoContext();
    return getRecoverableInstanceKeysFromGlobalStateKeys([...ctx.globalStateKeys()], (instanceKey) =>
      loadInstanceByKeyForList(ctx, instanceKey),
    );
  }

  getTaskSummaries(): WorkflowInstance[] {
    const ctx = this.persistence.instanceRepoContext();
    const list: WorkflowInstance[] = [];
    const seen = new Set<string>();
    for (const instanceKey of listKnownInstanceKeys(ctx)) {
      const inst = resolveInstanceForList(ctx, instanceKey);
      if (inst && !seen.has(instanceKey)) {
        seen.add(instanceKey);
        list.push(inst);
      }
    }
    return list;
  }

  getTaskListItems(): TaskListItem[] {
    const ctx = this.persistence.instanceRepoContext();
    const list: TaskListItem[] = [];
    const seen = new Set<string>();
    for (const instanceKey of listKnownInstanceKeys(ctx)) {
      const inst = resolveInstanceForList(ctx, instanceKey);
      if (inst && !seen.has(instanceKey)) {
        seen.add(instanceKey);
        list.push(buildTaskListItem(instanceKey, inst));
      }
    }
    return list;
  }

  deleteInstance(instanceKey: string, scope: DeleteScope = 'record'): void {
    const result = deleteInstanceRecord(this.persistence.instanceRepoContext(), instanceKey, scope);
    if (result.clearedActive) {
      this.lifecycle.clearActive();
    }
  }

  resolveReuseInstance(instanceKey?: string): {
    reuse: boolean;
    existing?: WorkflowInstance;
    instanceId: string;
  } {
    const state = this.lifecycle;
    return resolveReuseInstanceFromRepo(
      this.persistence.instanceRepoContext(),
      instanceKey,
      state.getActiveInstanceKey(),
      state.getInstance(),
    );
  }
}
