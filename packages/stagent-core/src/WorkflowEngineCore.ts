import type { BackendMessage, WorkflowInstance } from './WorkflowDefinition';
import type { PlatformAdapter } from './platform/PlatformAdapter';
import type { WorkflowUiBridge } from './WorkflowUiBridge';
import type { WorkflowInstanceManager } from './WorkflowInstanceManager';
import { PREFERRED_LM_STATE_KEY } from './instance/StagentGlobalStateKeys';
import { getReadableProjectRoots, pickZoomOutFilePath, resolveExistingDirectoryPath } from './WorkflowPathResolver';
import { createCoreDebugLog } from './core/CoreDebugLog';
import { createCoreLlmInvoker } from './core/CoreLlmInvoker';
import { createCorePostMessageHandler } from './core/CorePostMessageHandler';
import { getDecisionReviewContext as queryDecisionReviewContext } from './core/WorkflowDecisionReviewQuery';

export { evaluateSkipCondition } from './WorkflowSkipCondition';

export { estimateTokens } from './WorkflowInputContent';

/** IPC 胶水：postMessage 副作用、生成 bootstrap LLM/debug、决策复核查询。 */
export class WorkflowEngineCore {
  private readonly platform: PlatformAdapter;
  private instancesChangedListener: (() => void) | undefined;
  private instanceStack?: { ui: WorkflowUiBridge; manager: WorkflowInstanceManager };
  private preferredModelFamilyReader: () => string;
  private readonly debugApi: ReturnType<typeof createCoreDebugLog>;
  private readonly postMessageEffects: ReturnType<typeof createCorePostMessageHandler>;
  private readonly invokeLlmRaw: ReturnType<typeof createCoreLlmInvoker>;

  constructor(platform: PlatformAdapter) {
    this.platform = platform;
    this.preferredModelFamilyReader = () => platform.state.get<string>(PREFERRED_LM_STATE_KEY) ?? '';
    const getInstance = () => this.getActiveInstance();
    const getInstanceKey = () => this.getActiveInstanceKey();
    this.debugApi = createCoreDebugLog({
      platform,
      getInstance,
      getInstanceKey,
      warn: (message) => this.warn(message),
    });
    this.postMessageEffects = createCorePostMessageHandler({
      platform,
      getInstance,
      getInstanceKey,
      getExperiencePersistedForKey: () => this.instanceStack?.manager.experiencePersistedForKey,
      setExperiencePersistedForKey: (key) => {
        if (this.instanceStack) {
          this.instanceStack.manager.experiencePersistedForKey = key;
        }
      },
      warn: (message) => this.warn(message),
      debug: this.debugApi,
    });
    this.invokeLlmRaw = createCoreLlmInvoker({
      platform,
      getPreferredModelFamily: () => this.preferredModelFamilyReader(),
      sendBackendMessage: (msg) => {
        this.postMessageEffects.handlePreSend(msg);
        this.platform.ui.send(msg);
      },
      debug: this.debugApi,
    });
  }

  /** 与 EngineRuntimeState.preferredModelFamily 同步（模块化执行门面写入）。 */
  bindPreferredModelFamilyReader(reader: () => string): void {
    this.preferredModelFamilyReader = reader;
  }

  get platformAccessor(): PlatformAdapter {
    return this.platform;
  }

  postMessage(msg: BackendMessage): void {
    this.postMessageEffects.handlePreSend(msg);
    this.platform.ui.send(msg);
  }

  setInstancesChangedListener(listener: (() => void) | undefined): void {
    this.instancesChangedListener = listener;
    this.instanceStack?.manager.setInstancesChangedListener(listener);
  }

  getActiveInstanceKey(): string | undefined {
    return this.instanceStack?.manager.currentInstanceKey;
  }

  getActiveInstance(): WorkflowInstance | undefined {
    return this.instanceStack?.manager.instance;
  }

  getDecisionReviewContext(stageId: string) {
    return queryDecisionReviewContext(this.getActiveInstance(), stageId);
  }

  attachInstanceStack(ui: WorkflowUiBridge, manager: WorkflowInstanceManager): void {
    this.instanceStack = { ui, manager };
  }

  resolveExistingDirectoryPathPublic(
    raw: string,
  ): { ok: true; abs: string } | { ok: false; reason: string } {
    return resolveExistingDirectoryPath(raw);
  }

  pickZoomOutFilePathPublic(preferred?: string): string {
    return pickZoomOutFilePath(getReadableProjectRoots(this.platform.paths.workspaceRoot()), preferred);
  }

  async invokeLlmRawPublic(
    systemPrompt: string,
    userContent: string,
    traceStageId: string,
    opts?: { requireStructured?: boolean; jsonMode?: boolean; maxTokens?: number },
  ): Promise<string> {
    return this.invokeLlmRaw(systemPrompt, userContent, traceStageId, opts);
  }

  debugLogPublic(stageId: string, event: string, attempt: number, payload?: unknown): void {
    this.debugApi.debugLog(stageId, event, attempt, payload);
  }

  degradedPublic(reason: string, context?: Record<string, unknown>): void {
    this.debugApi.debugLog('workflow', 'degraded', 0, { reason, ...context });
  }

  getInstancePublic(): WorkflowInstance | undefined {
    return this.getActiveInstance();
  }

  setInstancePublic(inst: WorkflowInstance | undefined): void {
    if (this.instanceStack) {
      this.instanceStack.manager.instance = inst;
    }
  }

  setCurrentInstanceKeyPublic(key: string | undefined): void {
    if (this.instanceStack) {
      this.instanceStack.manager.currentInstanceKey = key;
    }
  }

  scheduleSavePublic(): void {
    this.instanceStack?.manager.persistence.scheduleSave();
  }

  private warn(message: string): void {
    console.warn(`[Stagent] ${message}`);
  }
}
