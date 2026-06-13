import type { ExtensionContext, WebviewPanel } from './platform/HostTypes';
import type { EngineHostFactoryDeps } from './WorkflowEngineHostFactories';
import type { WorkflowUiBridge } from './WorkflowUiBridge';
import type { WorkflowInstance } from './WorkflowDefinition';
import { InstanceCatalog } from './instance/InstanceCatalog';
import { InstanceDraftFacade } from './instance/InstanceDraftFacade';
import { InstanceLifecycle } from './instance/InstanceLifecycle';
import { InstancePersistenceOps } from './instance/InstancePersistenceOps';
import { InstanceResumeFacade } from './instance/InstanceResumeFacade';

export interface WorkflowInstanceManagerHooks {
  context: ExtensionContext;
  ui: WorkflowUiBridge;
  warn: (message: string) => void;
  degraded: (reason: string, context?: Record<string, unknown>) => void;
  onGlobalStateFailed?: (instanceKey: string) => void;
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void;
  getExecutionDepth: () => number;
  executeNextStage: (panel?: WebviewPanel) => Promise<void>;
  expandUserHomePath: (raw: string) => string;
  resolveExistingDirectoryPath: (
    raw: string,
  ) => { ok: true; abs: string } | { ok: false; reason: string };
  workspaceFolderPath: () => string | undefined;
  hostFactoryDeps: () => EngineHostFactoryDeps;
}

/** 活跃实例指针 + 持久化防抖；子模块承载具体职责。 */
export class WorkflowInstanceManager {
  instance: WorkflowInstance | undefined;
  currentInstanceKey: string | undefined;
  experiencePersistedForKey: string | undefined;

  readonly lifecycle: InstanceLifecycle;
  readonly persistence: InstancePersistenceOps;
  readonly catalog: InstanceCatalog;
  readonly draft: InstanceDraftFacade;
  readonly resume: InstanceResumeFacade;

  private instancesChangedListener: (() => void) | undefined;

  constructor(private readonly hooks: WorkflowInstanceManagerHooks) {
    this.lifecycle = new InstanceLifecycle(this);
    this.persistence = new InstancePersistenceOps(this, {
      context: hooks.context,
      warn: (message) => hooks.warn(message),
      degraded: (reason, context) => hooks.degraded(reason, context),
      workspaceFolderPath: () => hooks.workspaceFolderPath(),
      notifyInstancesChanged: () => this.notifyInstancesChanged(),
      onGlobalStateFailed: hooks.onGlobalStateFailed,
    });
    this.catalog = new InstanceCatalog(this.lifecycle, this.persistence);
    this.draft = new InstanceDraftFacade(() => hooks.hostFactoryDeps());
    this.resume = new InstanceResumeFacade(() => hooks.hostFactoryDeps());
  }

  setUi(ui: WorkflowUiBridge): void {
    this.hooks.ui = ui;
  }

  get ui(): WorkflowUiBridge {
    return this.hooks.ui;
  }

  setInstancesChangedListener(listener: (() => void) | undefined): void {
    this.instancesChangedListener = listener;
  }

  private notifyInstancesChanged(): void {
    try {
      this.instancesChangedListener?.();
    } catch (e) {
      this.hooks.warn(`instances_changed_listener_failed: ${String(e)}`);
    }
  }
}
