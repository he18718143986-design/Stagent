import type { PlatformAdapter } from '../platform/PlatformAdapter';
import type { EngineHostFactoryDeps } from '../engine-host';
import { WorkflowEngineCore } from '../WorkflowEngineCore';
import { createEngineFacades, type EngineFacades } from '../engine-facades/createEngineFacades';
import { WorkflowEngineLifecycle } from '../engine-facades/WorkflowEngineLifecycle';
import { WorkflowEngineDiagnostics } from '../WorkflowEngineDiagnostics';
import { WorkflowEngineHostRegistry } from '../WorkflowEngineHostRegistry';
import { WorkflowEngineInternals } from '../WorkflowEngineInternals';
import { voidGlobalStateUpdate } from '../instance/GlobalStateSafeUpdate';
import { createPlatformEngineLlm } from './PlatformEngineLlm';
import { platformConfirmDialog } from '../generation/confirmDialogAdapter';
import { registerBuiltinQualityGates } from '../BuiltinQualityGates';
import { bindStagentConfigPort } from '../settings/bindStagentConfig';
import { buildEngineHostFactoryDeps } from './buildEngineHostFactoryDeps';
import { buildHostExtensionContext } from './buildHostDepsFromPlatform';
import { buildBootstrapHostFactoryDeps, createGenerationService } from './coreGenerationBridge';
import { EngineRuntimeState } from './EngineRuntimeState';
import { LateBound } from './LateBound';
import {
  WorkflowGenerationService,
  type WorkflowGenerationService as WorkflowGenerationServiceType,
} from '../WorkflowGenerationService';
import type { HostPanel } from '../platform/HostTypes';
import type { BackendMessage } from '../WorkflowDefinition';
import {
  CHARTER_FEEDBACK_LAST_ASKED_KEY,
  FEEDBACK_LAST_ASKED_KEY,
  PREFERRED_LM_STATE_KEY,
} from '../instance/StagentGlobalStateKeys';
import { WorkflowUiBridge, type MockWebviewPanel } from '../WorkflowUiBridge';
import { WorkflowInstanceManager } from '../WorkflowInstanceManager';
import { buildMessagingHost } from '../WorkflowEngineHostFactories';
import type { MessagingHost } from '../WorkflowEngineMessaging';
import {
  getDefaultTaskDir,
  loadInstanceByKey,
  resolveInitialTaskDirForStart,
} from '../WorkflowInstanceRepository';
import { expandUserHomePath, resolveExistingDirectoryPath } from '../WorkflowPathResolver';

export interface WorkflowEngineParts {
  readonly state: EngineRuntimeState;
  readonly core: WorkflowEngineCore;
  readonly facades: EngineFacades;
  readonly hostContext: ReturnType<typeof buildHostExtensionContext>;
  readonly hostFactoryDeps: EngineHostFactoryDeps;
  readonly ui: WorkflowUiBridge;
  readonly instanceManager: WorkflowInstanceManager;
  readonly lifecycle?: WorkflowEngineLifecycle;
  readonly diagnostics?: WorkflowEngineDiagnostics;
  readonly internals?: WorkflowEngineInternals;
  /** 模块化生成服务（默认启用）。 */
  readonly generationService?: WorkflowGenerationServiceType;
  /** 执行循环回填 ref（与 vscode executeNextStageRef 同构）。 */
  readonly executeNextStageRef: { fn: (panel?: HostPanel) => Promise<void> };
}

function buildInstanceStackOverrides(
  platform: PlatformAdapter,
  state: EngineRuntimeState,
  instanceManager: WorkflowInstanceManager,
  ui: WorkflowUiBridge,
  headlessPanel: MockWebviewPanel,
  executeNextStage: (panel?: HostPanel) => Promise<void>,
): Partial<EngineHostFactoryDeps> {
  const repoCtx = () => instanceManager.persistence.instanceRepoContext();
  return {
    bindPanel: (panel) => ui.bindPanel((panel ?? headlessPanel) as HostPanel),
    postMessage: (panel, msg: BackendMessage) => ui.postMessage(panel as HostPanel, msg),
    beginUiResync: () => {
      ui.beginUiResync();
    },
    postGenerationProgress: (panel, operation, phase, message, detail) =>
      ui.postGenerationProgress(
        (panel ?? headlessPanel) as HostPanel,
        operation,
        phase,
        message,
        detail,
      ),
    getInstance: () => instanceManager.instance,
    setInstance: (inst) => {
      instanceManager.instance = inst;
    },
    getCurrentInstanceKey: () => instanceManager.currentInstanceKey,
    setCurrentInstanceKey: (key) => {
      instanceManager.currentInstanceKey = key;
    },
    clearSaveTimer: () => instanceManager.persistence.clearSaveTimer(),
    scheduleSave: () => instanceManager.persistence.scheduleSave(),
    persistMilestone: () => instanceManager.persistence.persistMilestone(),
    persistInstanceSnapshot: (key, inst) => instanceManager.persistence.persistInstanceSnapshot(key, inst),
    loadInstanceByKey: (key) => loadInstanceByKey(repoCtx(), key),
    deleteInstance: (key, scope) => instanceManager.catalog.deleteInstance(key, scope),
    resolveReuseInstance: (key) => instanceManager.catalog.resolveReuseInstance(key),
    getDefaultTaskDir: (id) => getDefaultTaskDir(repoCtx(), id),
    resolveInitialTaskDirForStart: (id, wf) => resolveInitialTaskDirForStart(repoCtx(), id, wf),
    expandUserHomePath: (raw) => expandUserHomePath(raw),
    resolveExistingDirectoryPath: (raw) => resolveExistingDirectoryPath(raw),
    workspaceFolderPath: () => platform.paths.workspaceRoot(),
    getExperiencePersistedForKey: () => instanceManager.experiencePersistedForKey,
    setExperiencePersistedForKey: (key) => {
      instanceManager.experiencePersistedForKey = key;
    },
    getExecutionDepth: () => state.executionDepth,
    executeNextStage: (panel) => executeNextStage(panel),
    warn: (message) => {
      void platform.notify.warn(message);
    },
    degraded: (reason, context) => {
      void platform.notify.warn(`degraded:${reason} ${JSON.stringify(context ?? {})}`);
    },
    error: (message) => {
      void platform.notify.error(message);
    },
  };
}

export function createWorkflowEngineParts(platform: PlatformAdapter): WorkflowEngineParts {
  bindStagentConfigPort(platform.config);
  registerBuiltinQualityGates(undefined, (reason, context) => {
    void platform.notify.warn(`degraded:${reason} ${JSON.stringify(context ?? {})}`);
  });
  const hostContext = buildHostExtensionContext(platform);
  const state = new EngineRuntimeState(platform.state.get<string>(PREFERRED_LM_STATE_KEY) ?? '');
  const executeNextStageRef: { fn: (panel?: HostPanel) => Promise<void> } = { fn: async () => {} };

  const core = new WorkflowEngineCore(platform);
  core.bindPreferredModelFamilyReader(() => state.preferredModelFamily);

  const headlessPanel: MockWebviewPanel = {
    webview: {
      postMessage: (msg: BackendMessage) => {
        platform.ui.send(msg);
      },
    },
  };

  let cachedHostFactoryDeps: EngineHostFactoryDeps | undefined;
  let cachedMessagingHost: MessagingHost | undefined;
  const resolveHostFactoryDeps = (): EngineHostFactoryDeps => {
    if (!cachedHostFactoryDeps) {
      throw new Error('hostFactoryDeps not initialized');
    }
    return cachedHostFactoryDeps;
  };

  const ui = new WorkflowUiBridge({
    messagingHost: () => {
      if (!cachedMessagingHost) {
        cachedMessagingHost = buildMessagingHost(resolveHostFactoryDeps());
      }
      return cachedMessagingHost;
    },
    getFeedbackLastAsked: () => hostContext.globalState.get<string>(FEEDBACK_LAST_ASKED_KEY),
    setFeedbackLastAsked: async (iso) => {
      await hostContext.globalState.update(FEEDBACK_LAST_ASKED_KEY, iso);
    },
    getCharterFeedbackLastAsked: () =>
      hostContext.globalState.get<string>(CHARTER_FEEDBACK_LAST_ASKED_KEY),
    setCharterFeedbackLastAsked: async (iso) => {
      await hostContext.globalState.update(CHARTER_FEEDBACK_LAST_ASKED_KEY, iso);
    },
  });
  ui.bindPanel(headlessPanel as HostPanel);

  cachedHostFactoryDeps = buildEngineHostFactoryDeps({
    adapter: platform,
    hostContext,
    getGenerationSeq: () => 0,
  });

  const instanceManager = new WorkflowInstanceManager({
    context: hostContext,
    ui,
    warn: (message) => {
      void platform.notify.warn(message);
    },
    degraded: (reason, context) => {
      void platform.notify.warn(`degraded:${reason} ${JSON.stringify(context ?? {})}`);
    },
    onGlobalStateFailed: (instanceKey) => {
      void platform.notify.warn(`global_state_sync_degraded key=${instanceKey}`);
      if (!state.globalStateRewriteInFlight.has(instanceKey)) {
        state.globalStateRewriteInFlight.add(instanceKey);
        try {
          instanceManager.persistence.persistMilestone();
        } finally {
          state.globalStateRewriteInFlight.delete(instanceKey);
        }
      }
    },
    debugLog: (stageId, event, attempt, payload) =>
      core.debugLogPublic(stageId, event, attempt, payload),
    getExecutionDepth: () => state.executionDepth,
    executeNextStage: (panel) => executeNextStageRef.fn(panel),
    expandUserHomePath: (raw) => expandUserHomePath(raw),
    resolveExistingDirectoryPath: (raw) => resolveExistingDirectoryPath(raw),
    workspaceFolderPath: () => platform.paths.workspaceRoot(),
    hostFactoryDeps: resolveHostFactoryDeps,
  });

  const instanceOverrides = buildInstanceStackOverrides(
    platform,
    state,
    instanceManager,
    ui,
    headlessPanel,
    (panel) => executeNextStageRef.fn(panel),
  );

  core.attachInstanceStack(ui, instanceManager);

  const internalsRef = new LateBound<WorkflowEngineInternals>('WorkflowEngineInternals');
  const bootstrapHostFactoryDeps = (): EngineHostFactoryDeps => {
    const gen = createGenerationService({ core, instanceManager });
    return {
      ...buildBootstrapHostFactoryDeps({ core, instanceManager }, () => gen.getGenerationSeq(), gen),
      ...instanceOverrides,
    };
  };
  const resolveModularHostFactoryDeps = (): EngineHostFactoryDeps => {
      if (internalsRef.isBound()) {
        return internalsRef.get().hostFactoryDeps((panel) => executeNextStageRef.fn(panel));
      }
      return bootstrapHostFactoryDeps();
  };

  cachedHostFactoryDeps = bootstrapHostFactoryDeps();

  const lifecycle = new WorkflowEngineLifecycle(ui, instanceManager);

  const diagnostics = new WorkflowEngineDiagnostics({
      getActiveInstanceKey: () => instanceManager.lifecycle.getActiveInstanceKey(),
      getTraceId: () => instanceManager.lifecycle.getInstance()?.traceId,
      ensureTaskDir: (key) => internalsRef.get().ensureTaskDir(key),
      getOrCreateOutputChannel: () => internalsRef.get().getOutputChannel(),
      getGlobalStoragePath: () =>
        hostContext.globalStorageUri?.fsPath ?? hostContext.storagePath ?? '',
  });

  const llm = createPlatformEngineLlm(core);

  const hostRegistry = new WorkflowEngineHostRegistry(
      () => resolveModularHostFactoryDeps(),
      llm,
      () => instanceManager.persistence.scheduleSave(),
      (panel, msg) => lifecycle.postMessage(panel, msg),
      (stageId, event, attempt, payload) =>
        internalsRef.get().debugLog(stageId, event, attempt, payload),
      (kind, detail) => diagnostics.logUserAction(kind, detail),
      (message) => internalsRef.get().warn(message),
      (key, panel) => instanceManager.resume.ensureInstanceBound(key, panel),
  );

  const modularGenerationService = new WorkflowGenerationService({
      ui,
      confirmDialog: platformConfirmDialog(platform),
      hostFactoryDeps: () => resolveModularHostFactoryDeps(),
      invokeLlmRaw: (sys, user, panel, trace, opts) =>
        internalsRef.get().invokeLlmRaw(sys, user, panel, trace, opts),
      pickZoomOutFilePath: (pref) => internalsRef.get().pickZoomOutFilePath(pref),
      debugLog: (stageId, event, attempt, payload) =>
        internalsRef.get().debugLog(stageId, event, attempt, payload),
      degraded: (reason, context) => internalsRef.get().degraded(reason, context),
  });

  const internals = new WorkflowEngineInternals({
      context: hostContext,
      instances: instanceManager,
      generation: modularGenerationService,
      ui,
      llm,
      diagnostics,
      hostRegistry,
      getExecutionDepth: () => state.executionDepth,
      setExecutionDepth: (depth) => {
        state.executionDepth = depth;
      },
      getPreferredModelFamily: () => state.preferredModelFamily,
      getInstancesChangedListener: () => lifecycle.getInstancesChangedListener(),
      getOutputChannelRef: () => state.outputChannel,
      setOutputChannelRef: (channel) => {
        state.outputChannel = channel;
      },
      workspaceFolderPath: () => platform.paths.workspaceRoot(),
  });
  internalsRef.set(internals);
  cachedHostFactoryDeps = resolveModularHostFactoryDeps();
  cachedMessagingHost = buildMessagingHost(cachedHostFactoryDeps);

  const facades = createEngineFacades({
      context: hostContext,
      instanceManager,
      generationService: modularGenerationService,
      ui,
      diagnostics,
      llm,
      hostRegistry,
      getInternals: () => internalsRef.get(),
      getExecutionDepth: () => state.executionDepth,
      getPreferredModelFamily: () => state.preferredModelFamily,
      setPreferredModelFamily: (modelFamily) => {
        state.preferredModelFamily = modelFamily;
        voidGlobalStateUpdate(
          () => hostContext.globalState.update(PREFERRED_LM_STATE_KEY, modelFamily),
          (m) => diagnostics.warn(m),
          PREFERRED_LM_STATE_KEY,
        );
      },
  });
  executeNextStageRef.fn = (panel) => facades.execution.executeNextStage(panel);

  return {
    state,
    core,
    facades,
    hostContext,
    hostFactoryDeps: cachedHostFactoryDeps,
    ui,
    instanceManager,
    lifecycle,
    diagnostics,
    internals,
    generationService: modularGenerationService,
    executeNextStageRef,
  };
}
