import type { WebviewPanel } from './platform/HostTypes';
import type { EngineLlmPort } from './platform/EngineLlmPort';
import { createStageExecutionHost, type StageExecutionHost } from './StageExecutionHost';
import {
  buildArtifactUiHost,
  buildHitlHost,
  buildPathHost,
  buildStartExecutionHost,
  buildWorkspaceLintContext,
  type EngineHostFactoryDeps,
} from './WorkflowEngineHostFactories';
import type { BackendMessage } from './WorkflowDefinition';

/** `stageExecutionHost()` 返回宽 Host（Messaging ∩ Llm ∩ Path ∩ Quality），见 execution-bindings/types.ts。 */
export class WorkflowEngineHostRegistry {
  private cachedDeps: EngineHostFactoryDeps | undefined;
  private workspaceLintContextCache: ReturnType<typeof buildWorkspaceLintContext> | undefined;
  private pathHostCache: ReturnType<typeof buildPathHost> | undefined;
  private stageHost: StageExecutionHost | undefined;
  private hitlHostCache: ReturnType<typeof buildHitlHost> | undefined;
  private startExecutionHostCache: ReturnType<typeof buildStartExecutionHost> | undefined;
  private artifactUiHostCache: ReturnType<typeof buildArtifactUiHost> | undefined;

  constructor(
    private readonly deps: () => EngineHostFactoryDeps,
    private readonly llm: EngineLlmPort,
    private readonly scheduleSave: () => void,
    private readonly postMessage: (panel: WebviewPanel | undefined, msg: BackendMessage) => void,
    private readonly debugLog: (
      stageId: string,
      event: string,
      attempt: number,
      payload?: unknown,
    ) => void,
    private readonly logUserAction: (kind: string, detail: Record<string, unknown>) => void,
    private readonly warn: (message: string) => void,
    private readonly ensureInstanceBound: (
      instanceKey: string | undefined,
      panel: WebviewPanel,
    ) => boolean,
  ) {}

  private resolvedDeps(): EngineHostFactoryDeps {
    if (!this.cachedDeps) {
      this.cachedDeps = this.deps();
    }
    return this.cachedDeps;
  }

  workspaceLintContext() {
    if (!this.workspaceLintContextCache) {
      this.workspaceLintContextCache = buildWorkspaceLintContext(this.resolvedDeps());
    }
    return this.workspaceLintContextCache;
  }

  pathHost() {
    if (!this.pathHostCache) {
      this.pathHostCache = buildPathHost(this.resolvedDeps());
    }
    return this.pathHostCache;
  }

  stageExecutionHost(): StageExecutionHost {
    if (!this.stageHost) {
      const deps = this.resolvedDeps();
      this.stageHost = createStageExecutionHost({
        getInstance: () => deps.getInstance(),
        getCurrentInstanceKey: () => deps.getCurrentInstanceKey(),
        setCurrentInstanceKey: (key) => {
          deps.setCurrentInstanceKey(key);
        },
        scheduleSave: () => this.scheduleSave(),
        persistMilestone: () => deps.persistMilestone(),
        postMessage: (panel, msg) => this.postMessage(panel, msg),
        debugLog: (stageId, event, attempt, payload) => this.debugLog(stageId, event, attempt, payload),
        logUserAction: (kind, detail) => this.logUserAction(kind, detail),
        warn: (message) => this.warn(message),
        llm: this.llm,
        getPathHost: () => this.pathHost(),
        workspaceLintContext: () => this.workspaceLintContext(),
      });
    }
    return this.stageHost;
  }

  hitlHost() {
    if (!this.hitlHostCache) {
      this.hitlHostCache = buildHitlHost(
        this.resolvedDeps(),
        (key, panel) => this.ensureInstanceBound(key, panel),
      );
    }
    return this.hitlHostCache;
  }

  startExecutionHost() {
    if (!this.startExecutionHostCache) {
      this.startExecutionHostCache = buildStartExecutionHost(this.resolvedDeps());
    }
    return this.startExecutionHostCache;
  }

  artifactUiHost() {
    if (!this.artifactUiHostCache) {
      this.artifactUiHostCache = buildArtifactUiHost(this.resolvedDeps());
    }
    return this.artifactUiHostCache;
  }
}
