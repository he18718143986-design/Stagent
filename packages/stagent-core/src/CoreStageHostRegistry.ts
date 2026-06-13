import type { BackendMessage, WorkflowInstance } from './WorkflowDefinition';
import type { WebviewPanel } from './platform/HostTypes';
import type { StageExecutionLlmPort } from './platform/StageExecutionLlmPort';
import { createStageExecutionHost, type StageExecutionHost } from './StageExecutionHost';
import { createPathHost } from './WorkflowEnginePathHost';
import type { WorkspaceLintContext } from './WorkflowEngineWorkspaceLint';

export interface CoreStageHostRegistryDeps {
  getInstance: () => WorkflowInstance | undefined;
  getCurrentInstanceKey: () => string | undefined;
  setCurrentInstanceKey: (key: string | undefined) => void;
  scheduleSave: () => void;
  persistMilestone: () => void;
  postMessage: (panel: WebviewPanel | undefined, msg: BackendMessage) => void;
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void;
  logUserAction: (kind: string, detail: Record<string, unknown>) => void;
  warn: (message: string) => void;
  llm: StageExecutionLlmPort;
  getDefaultTaskDir: (instanceId: string) => string;
  workspaceFolderPath: () => string | undefined;
  getWorkspaceRootAbsolute: () => string | undefined;
  trackPersistedFile: (input: {
    stageId: string;
    outputKey: string;
    filePath: string;
    content: string;
    existedBefore: boolean;
    priorContent?: string;
  }) => void;
  workspaceLintContext: () => WorkspaceLintContext;
}

/** autoAI：最小 stage host 注册表（仅 stageExecutionHost，无 vscode HostFactories）。 */
export class CoreStageHostRegistry {
  private pathHostCache: ReturnType<typeof createPathHost> | undefined;
  private stageHost: StageExecutionHost | undefined;

  constructor(private readonly deps: CoreStageHostRegistryDeps) {}

  stageExecutionHost(): StageExecutionHost {
    if (!this.stageHost) {
      this.stageHost = createStageExecutionHost({
        getInstance: () => this.deps.getInstance(),
        getCurrentInstanceKey: () => this.deps.getCurrentInstanceKey(),
        setCurrentInstanceKey: (key) => this.deps.setCurrentInstanceKey(key),
        scheduleSave: () => this.deps.scheduleSave(),
        persistMilestone: () => this.deps.persistMilestone(),
        postMessage: (panel, msg) => this.deps.postMessage(panel, msg),
        debugLog: (stageId, event, attempt, payload) =>
          this.deps.debugLog(stageId, event, attempt, payload),
        logUserAction: (kind, detail) => this.deps.logUserAction(kind, detail),
        warn: (message) => this.deps.warn(message),
        llm: this.deps.llm,
        getPathHost: () => this.pathHost(),
        workspaceLintContext: () => this.deps.workspaceLintContext(),
      });
    }
    return this.stageHost;
  }

  private pathHost(): ReturnType<typeof createPathHost> {
    if (!this.pathHostCache) {
      this.pathHostCache = createPathHost({
        getInstance: () => this.deps.getInstance(),
        getCurrentInstanceKey: () => this.deps.getCurrentInstanceKey(),
        getDefaultTaskDir: (id) => this.deps.getDefaultTaskDir(id),
        getVscodeWorkspaceFolder: () => this.deps.workspaceFolderPath(),
        warn: (msg) => this.deps.warn(msg),
        debugLog: (stageId, event, attempt, payload) =>
          this.deps.debugLog(stageId, event, attempt, payload),
        trackPersistedFile: (input) => this.deps.trackPersistedFile(input),
      });
    }
    return this.pathHostCache;
  }
}
