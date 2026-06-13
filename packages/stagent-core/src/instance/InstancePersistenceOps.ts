import type { ExtensionContext } from '../platform/HostTypes';
import type { WorkflowInstance } from '../WorkflowDefinition';
import { flushInstanceSaveAsync, persistInstanceSnapshotSync } from '../WorkflowEnginePersistenceBridge';
import {
  buildInstanceRepoContext,
  buildPersistenceBridgeDeps,
  type InstanceRepoFactoryInput,
  type PersistenceBridgeFactoryInput,
} from '../WorkflowEngineHostFactories';
import type { InstanceActiveState } from './InstanceLifecycle';
import { INSTANCE_PERSIST_DEBOUNCE_MS } from '../TimeConstants';

export interface InstancePersistenceHooks {
  context: ExtensionContext;
  warn: (message: string) => void;
  degraded: (reason: string, context?: Record<string, unknown>) => void;
  workspaceFolderPath: () => string | undefined;
  notifyInstancesChanged: () => void;
  onGlobalStateFailed?: (instanceKey: string) => void;
}

export class InstancePersistenceOps {
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly state: InstanceActiveState,
    private readonly hooks: InstancePersistenceHooks,
  ) {}

  clearSaveTimer(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
  }

  scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.flushSave().catch((e) => {
        this.hooks.warn(`flush_save_failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    }, INSTANCE_PERSIST_DEBOUNCE_MS);
  }

  async flushSave(): Promise<void> {
    if (!this.state.instance || !this.state.currentInstanceKey) {
      return;
    }
    await flushInstanceSaveAsync(this.persistenceBridgeDeps(), this.state.currentInstanceKey, this.state.instance);
  }

  persistInstanceSnapshot(key: string, inst: WorkflowInstance): void {
    persistInstanceSnapshotSync(this.persistenceBridgeDeps(), key, inst);
  }

  persistMilestone(): void {
    if (!this.state.instance || !this.state.currentInstanceKey) {
      return;
    }
    this.persistInstanceSnapshot(this.state.currentInstanceKey, this.state.instance);
  }

  persistenceBridgeDeps() {
    return buildPersistenceBridgeDeps(this.persistenceBridgeFactoryInput());
  }

  instanceRepoContext() {
    return buildInstanceRepoContext(this.repoFactoryInput());
  }

  private repoFactoryInput(): InstanceRepoFactoryInput {
    return {
      context: this.hooks.context,
      getCurrentInstanceKey: () => this.state.currentInstanceKey,
      getInstance: () => this.state.instance,
      setInstance: (inst) => {
        this.state.instance = inst;
      },
      setCurrentInstanceKey: (key) => {
        this.state.currentInstanceKey = key;
      },
      clearSaveTimer: () => this.clearSaveTimer(),
      warn: (message) => this.hooks.warn(message),
      notifyInstancesChanged: () => this.hooks.notifyInstancesChanged(),
      workspaceFolderPath: () => this.hooks.workspaceFolderPath(),
    };
  }

  private persistenceBridgeFactoryInput(): PersistenceBridgeFactoryInput {
    return {
      context: this.hooks.context,
      workspaceFolderPath: () => this.hooks.workspaceFolderPath(),
      warn: (message) => this.hooks.warn(message),
      degraded: (reason, context) => this.hooks.degraded(reason, context),
      notifyInstancesChanged: () => this.hooks.notifyInstancesChanged(),
      onGlobalStateFailed: this.hooks.onGlobalStateFailed,
    };
  }
}
