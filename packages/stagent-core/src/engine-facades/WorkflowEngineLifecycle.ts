import type { BackendMessage } from '../WorkflowDefinition';
import type { WorkflowInstanceManager } from '../WorkflowInstanceManager';
import type { WorkflowUiBridge } from '../WorkflowUiBridge';
import type { HostPanel } from '../platform/HostTypes';

/** 引擎级 UI / 持久化表面（从 WorkflowEngine 抽出以降低类内关注点）。 */
export class WorkflowEngineLifecycle {
  private instancesChangedListener: (() => void) | undefined;

  constructor(
    private readonly ui: WorkflowUiBridge,
    private readonly instanceManager: WorkflowInstanceManager,
  ) {}

  persistMilestone(): void {
    this.instanceManager.persistence.persistMilestone();
  }

  postMessage(panel: HostPanel | undefined, msg: BackendMessage): void {
    this.ui.postMessage(panel, msg);
  }

  setInstancesChangedListener(listener: (() => void) | undefined): void {
    this.instancesChangedListener = listener;
    this.instanceManager.setInstancesChangedListener(listener);
  }

  getInstancesChangedListener(): (() => void) | undefined {
    return this.instancesChangedListener;
  }
}
