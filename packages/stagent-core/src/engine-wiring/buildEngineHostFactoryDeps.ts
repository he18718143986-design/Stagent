import type { PlatformAdapter } from '../platform/PlatformAdapter';
import type { HostExtensionContext } from '../platform/HostTypes';
import type { EngineHostFactoryDeps } from '../engine-host';
import type { BackendMessage } from '../WorkflowDefinition';

const MAX_STAGE_WARN = 12;

/**
 * 从 PlatformAdapter 构建 Messaging 相关 HostDeps（阶段 0 最小集）。
 * Persistence / Generation / Execution 在阶段 1 由 WorkflowEngineCore 桥接补齐。
 */
export function buildMessagingDepsFromPlatform(
  adapter: PlatformAdapter,
): Pick<
  EngineHostFactoryDeps,
  | 'bindPanel'
  | 'postMessage'
  | 'beginUiResync'
  | 'postGenerationProgress'
  | 'warn'
  | 'degraded'
  | 'error'
  | 'debugLog'
  | 'logUserAction'
> {
  return {
    bindPanel: () => {},
    postMessage: (_panel, msg: BackendMessage) => adapter.ui.send(msg),
    beginUiResync: () => {},
    postGenerationProgress: (_panel, _operation, _phase, message, detail) => {
      adapter.ui.send({
        type: 'generationProgress',
        message,
        detail,
      });
    },
    warn: (message) => {
      void adapter.notify.warn(message);
    },
    degraded: () => {},
    error: (message) => {
      void adapter.notify.error(message);
    },
    debugLog: () => {},
    logUserAction: () => {},
  };
}

export interface BuildEngineHostFactoryDepsInput {
  adapter: PlatformAdapter;
  hostContext: HostExtensionContext;
  getGenerationSeq: () => number;
  overrides?: Partial<EngineHostFactoryDeps>;
}

export function buildEngineHostFactoryDeps(input: BuildEngineHostFactoryDepsInput): EngineHostFactoryDeps {
  const messaging = buildMessagingDepsFromPlatform(input.adapter);
  const stubs: EngineHostFactoryDeps = {
    ...messaging,
    context: input.hostContext,
    maxStageWarn: MAX_STAGE_WARN,
    getGenerationSeq: input.getGenerationSeq,
    getInstance: () => undefined,
    setInstance: () => {},
    getCurrentInstanceKey: () => undefined,
    setCurrentInstanceKey: () => {},
    clearSaveTimer: () => {},
    scheduleSave: () => {},
    persistMilestone: () => {},
    persistInstanceSnapshot: () => {},
    notifyInstancesChanged: () => {},
    workspaceFolderPath: () => input.adapter.paths.workspaceRoot(),
    resolveExistingDirectoryPath: () => ({ ok: false, reason: 'not-wired' }),
    expandUserHomePath: (raw) => raw,
    getDefaultTaskDir: (id) => id,
    resolveInitialTaskDirForStart: () => ({ ok: false, reason: 'not-wired' }),
    loadInstanceByKey: () => undefined,
    deleteInstance: () => {},
    getWorkspaceRootAbsolute: () => input.adapter.paths.workspaceRoot(),
    resolveOutputPath: (_k, filePath) => filePath,
    ensureTaskDir: (k) => k,
    trackPersistedFile: () => {},
    getExperiencePersistedForKey: () => undefined,
    setExperiencePersistedForKey: () => {},
    getPolishCache: () => new Map(),
    polishCacheKey: (draft, taskType) => `${taskType}:${draft}`,
    rememberPolishCache: () => {},
    ensurePreExecDraftShell: () => undefined,
    finalizeDraftDefinition: () => undefined,
    invokeLlmRaw: async () => '',
    parseWorkflowJson: async () => {
      throw new Error('parseWorkflowJson not wired');
    },
    normalizeWorkflow: (wf) => wf,
    isGenerationSuperseded: () => false,
    resolveReuseInstance: (key) => ({ reuse: false, instanceId: key ?? '' }),
    getExecutionDepth: () => 0,
    executeNextStage: async () => {},
    rejectApproveDecision: () => {},
    markStageArtifactsApproved: () => {},
  };
  return { ...stubs, ...input.overrides };
}
