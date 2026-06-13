import type * as vscode from '../platform/HostTypes';
import type { DeleteScope } from '../WorkflowDeletePlan';
import type { TaskListItem } from '../WorkflowInstanceQuery';
import type { WorkflowInstance } from '../WorkflowDefinition';
import type { WorkflowEngineInstanceFacade } from './WorkflowEngineFacades';
import type { WorkflowInstanceManager } from '../WorkflowInstanceManager';
import { resyncActiveInstancePanelUi } from '../resume/pushRecoveryUi';
import { getCurrentStageInfo as queryCurrentStageInfo } from '../WorkflowStageProgressQuery';

export class WorkflowInstanceFacadeImpl implements WorkflowEngineInstanceFacade {
  constructor(private readonly manager: WorkflowInstanceManager) {}

  getTaskListItems(): TaskListItem[] {
    return this.manager.catalog.getTaskListItems();
  }

  getTaskSummaries(): WorkflowInstance[] {
    return this.manager.catalog.getTaskSummaries();
  }

  deleteInstance(instanceKey: string, scope?: DeleteScope): void {
    this.manager.catalog.deleteInstance(instanceKey, scope);
  }

  async resumeInstance(instanceKey: string, panel: vscode.WebviewPanel): Promise<boolean> {
    return this.manager.resume.resumeInstance(instanceKey, panel);
  }

  getRecoverableInstanceKeys(): string[] {
    return this.manager.catalog.getRecoverableInstanceKeys();
  }

  pruneStaleGlobalInstances(): void {
    this.manager.catalog.pruneStaleGlobalInstances();
  }

  getActiveInstanceKey(): string | undefined {
    return this.manager.lifecycle.getActiveInstanceKey();
  }

  getActiveInstance(): WorkflowInstance | undefined {
    return this.manager.lifecycle.getInstance();
  }

  getActiveSessionId(): string | undefined {
    return this.manager.lifecycle.getActiveSessionId();
  }

  getCurrentStageInfo() {
    return queryCurrentStageInfo(this.manager.lifecycle.getInstance());
  }

  resyncPanelUi(panel: vscode.WebviewPanel): void {
    const instanceKey = this.manager.lifecycle.getActiveInstanceKey();
    const instance = this.manager.lifecycle.getInstance();
    if (!instanceKey || !instance) {
      return;
    }
    resyncActiveInstancePanelUi(
      {
        postMessage: (p, m) => this.manager.ui.postMessage(p, m),
        beginUiResync: () => {
          this.manager.ui.beginUiResync();
        },
      },
      panel,
      instance,
      instanceKey,
    );
  }
}
