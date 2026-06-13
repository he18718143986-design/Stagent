/**
 * M41：引擎 Host / Context 工厂 — 集中各 *Host() / *Context() 依赖注入组装。
 */
import type { WebviewPanel, ExtensionContext, WorkspaceConfiguration } from './platform/HostTypes';
import type { WorkflowDefinition, WorkflowInstance } from './WorkflowDefinition';
import { globalStateKeyForInstance } from './instance/InstanceGlobalStateKeys';
import type { InstanceRepositoryContext } from './WorkflowInstanceRepository';
import { createPathHost, type WorkflowEnginePathHost } from './WorkflowEnginePathHost';
import type { DraftShellDeps } from './WorkflowDraftShell';
import type { HitlCoordinatorHost } from './WorkflowHitlCoordinator';
import type { PreGenerationHost } from './WorkflowPreGenerationCoordinator';
import type { GenerationRunnerHost } from './WorkflowGenerationRunner';
import type { StartExecutionHost } from './WorkflowStartCoordinator';
import type { ArtifactUiHost } from './WorkflowArtifactUi';
import { writeWorkflowProcessDocs } from './WorkflowStartCoordinator';
import { readContractCommitmentsEnabled } from './settings/readers/contract';
import {
  readEngineDecisionContentLintEnabled,
  readEngineGenerationGates,
  readEngineGlossaryEnabled,
  readEngineMaxManualStageRetries,
  readEngineRuntimeRule20VerifyEnabled,
  readEngineSdkPathContractLintMode,
  readEnginePythonExportContractLintMode,
  readEnginePythonPypiSymbolLintMode,
} from './WorkflowEngineSettingsReaders';
import type { ResumeCoordinatorHost } from './WorkflowInstanceResumeCoordinator';
import type { MessagingHost } from './WorkflowEngineMessaging';
import type {
  ArtifactUiHostDeps,
  EngineHostFactoryDeps,
  GenerationRunnerHostDeps,
  HitlHostDeps,
  MessagingHostFactoryDeps,
  ResumeCoordinatorHostDeps,
  StartExecutionHostDeps,
} from './engine-host';
export type { EngineHostFactoryDeps } from './engine-host';

export interface InstanceRepoFactoryInput {
  context: ExtensionContext;
  getCurrentInstanceKey: () => string | undefined;
  getInstance: () => WorkflowInstance | undefined;
  setInstance: (instance: WorkflowInstance | undefined) => void;
  setCurrentInstanceKey: (key: string | undefined) => void;
  clearSaveTimer: () => void;
  warn: (message: string) => void;
  notifyInstancesChanged: () => void;
  workspaceFolderPath: () => string | undefined;
}

export interface PersistenceBridgeFactoryInput {
  context: ExtensionContext;
  workspaceFolderPath: () => string | undefined;
  warn: (message: string) => void;
  degraded: (reason: string, context?: Record<string, unknown>) => void;
  notifyInstancesChanged: () => void;
  onGlobalStateFailed?: (instanceKey: string) => void;
}

export function buildPersistenceBridgeDeps(input: PersistenceBridgeFactoryInput) {
  return {
    workspaceFolderPath: () => input.workspaceFolderPath(),
    globalStorageFsPath: input.context.globalStorageUri?.fsPath ?? input.context.storagePath ?? '',
    updateGlobalState: (key: string, value: WorkflowInstance) =>
      input.context.globalState.update(key, value),
    warn: (message: string) => input.warn(message),
    degraded: (reason: string, context?: Record<string, unknown>) => input.degraded(reason, context),
    notifyInstancesChanged: () => input.notifyInstancesChanged(),
    onGlobalStateFailed: input.onGlobalStateFailed,
  };
}

export function buildInstanceRepoContext(input: InstanceRepoFactoryInput): InstanceRepositoryContext {
  return {
    workspaceFolderPath: () => input.workspaceFolderPath(),
    globalStorageFsPath: input.context.globalStorageUri?.fsPath ?? input.context.storagePath ?? '',
    extensionDir: input.context.extensionUri?.fsPath ?? input.context.storagePath ?? '',
    globalStateKeys: () => input.context.globalState.keys(),
    getGlobalStateInstance: (instanceKey) =>
      input.context.globalState.get<WorkflowInstance>(globalStateKeyForInstance(instanceKey)),
    updateGlobalState: (instanceKey, value) =>
      input.context.globalState.update(globalStateKeyForInstance(instanceKey), value),
    warn: (message: string) => input.warn(message),
    notifyInstancesChanged: () => input.notifyInstancesChanged(),
    active: {
      key: input.getCurrentInstanceKey(),
      instance: input.getInstance(),
    },
    onActivePurged: (instanceKey) => {
      if (input.getCurrentInstanceKey() === instanceKey) {
        input.setInstance(undefined);
        input.setCurrentInstanceKey(undefined);
        input.clearSaveTimer();
      }
    },
  };
}

export function buildWorkspaceLintContext(deps: EngineHostFactoryDeps) {
  return {
    instance: deps.getInstance(),
    workspaceRootAbsolute: deps.getWorkspaceRootAbsolute(),
    glossaryEnabled: readEngineGlossaryEnabled(),
    sdkPathContractLintMode: readEngineSdkPathContractLintMode(),
    pythonExportContractLintMode: readEnginePythonExportContractLintMode(),
    pythonPypiSymbolLintMode: readEnginePythonPypiSymbolLintMode(),
  };
}

export function buildPathHost(deps: EngineHostFactoryDeps): WorkflowEnginePathHost {
  return createPathHost({
    getInstance: () => deps.getInstance(),
    getCurrentInstanceKey: () => deps.getCurrentInstanceKey(),
    getDefaultTaskDir: (id) => deps.getDefaultTaskDir(id),
    getVscodeWorkspaceFolder: () => deps.workspaceFolderPath(),
    warn: (msg) => deps.warn(msg),
    debugLog: (stageId, event, attempt, payload) => deps.debugLog(stageId, event, attempt, payload),
    trackPersistedFile: (input) => deps.trackPersistedFile(input),
  });
}

export function buildDraftShellDeps(deps: EngineHostFactoryDeps): DraftShellDeps {
  return {
    getState: () => ({
      currentInstanceKey: deps.getCurrentInstanceKey(),
      instance: deps.getInstance(),
    }),
    setActive: (key, instance) => {
      deps.setCurrentInstanceKey(key);
      deps.setInstance(instance);
    },
    clearActive: () => {
      deps.setInstance(undefined);
      deps.setCurrentInstanceKey(undefined);
    },
    resolveExistingDirectoryPath: (raw) => deps.resolveExistingDirectoryPath(raw),
    workspaceFolderPath: () => deps.workspaceFolderPath(),
    globalStorageFsPath: deps.context.globalStorageUri?.fsPath ?? deps.context.storagePath ?? '',
    getDefaultTaskDir: (id) => deps.getDefaultTaskDir(id),
    resolveInitialTaskDirForStart: (id, wf) => deps.resolveInitialTaskDirForStart(id, wf),
    scheduleSave: () => deps.scheduleSave(),
    persistMilestone: () => deps.persistMilestone(),
    debugLog: (stageId, event, attempt, payload) => deps.debugLog(stageId, event, attempt, payload),
    warn: (msg) => deps.warn(msg),
    deleteInstanceRecord: (key) => deps.deleteInstance(key, 'record'),
    clearExperiencePersistedFlag: () => deps.setExperiencePersistedForKey(undefined),
  };
}

export function buildHitlHost(
  deps: HitlHostDeps,
  ensureInstanceBound: (instanceKey: string | undefined, panel: WebviewPanel) => boolean,
): HitlCoordinatorHost {
  return {
    bindPanel: (panel) => deps.bindPanel(panel),
    getInstance: () => deps.getInstance(),
    postMessage: (panel, msg) => deps.postMessage(panel, msg),
    logUserAction: (kind, detail) => deps.logUserAction(kind, detail),
    markStageArtifactsApproved: (stageId) => deps.markStageArtifactsApproved(stageId),
    scheduleSave: () => deps.scheduleSave(),
    persistMilestone: () => deps.persistMilestone(),
    executeNextStage: (panel) => deps.executeNextStage(panel),
    ensureInstanceBound,
    rejectApproveDecision: (panel, stageId, reason) => deps.rejectApproveDecision(panel, stageId, reason),
    isDecisionContentLintVscodeDefault: () => readEngineDecisionContentLintEnabled(),
    isContractCommitmentsEnabled: () => readContractCommitmentsEnabled(),
    getMaxManualStageRetries: () => readEngineMaxManualStageRetries(),
    getWorkspaceRootAbsolute: () => deps.getWorkspaceRootAbsolute(),
    debugLog: (stageId, event, attempt, payload) => deps.debugLog(stageId, event, attempt, payload),
    warn: (msg) => deps.warn(msg),
    error: (msg) => deps.error(msg),
    bumpCurrentStageIndex: () => {
      const inst = deps.getInstance();
      if (inst) {
        inst.currentStageIndex++;
      }
    },
    setCurrentStageIndex: (index) => {
      const inst = deps.getInstance();
      if (inst) {
        inst.currentStageIndex = index;
      }
    },
    setInstanceStatus: (status) => {
      const inst = deps.getInstance();
      if (inst) {
        inst.status = status;
      }
    },
  };
}

export function buildPreGenerationHost(deps: EngineHostFactoryDeps): PreGenerationHost {
  return {
    bindPanel: (panel) => deps.bindPanel(panel),
    postMessage: (panel, msg) => deps.postMessage(panel, msg),
    postGenerationProgress: (panel, operation, phase, message, detail) =>
      deps.postGenerationProgress(panel, operation, phase, message, detail),
    ensurePreExecDraftShell: (opts) => deps.ensurePreExecDraftShell(opts),
    polishCacheKey: (draft, taskType, polishTier) => deps.polishCacheKey(draft, taskType, polishTier),
    getPolishCacheHit: (cacheKey) => deps.getPolishCache().get(cacheKey),
    rememberPolishCache: (cacheKey, text, polishedAt) =>
      deps.rememberPolishCache(cacheKey, text, polishedAt),
    getCurrentInstanceKey: () => deps.getCurrentInstanceKey(),
    invokeLlmRaw: (sys, user, panel, trace) => deps.invokeLlmRaw(sys, user, panel, trace),
    warn: (msg) => deps.warn(msg),
    degraded: (reason, context) => deps.degraded(reason, context),
  };
}

export function buildGenerationRunnerHost(deps: GenerationRunnerHostDeps): GenerationRunnerHost {
  return {
    bindPanel: (panel) => deps.bindPanel(panel),
    postMessage: (panel, msg) => deps.postMessage(panel, msg),
    postGenerationProgress: (panel, operation, phase, message, detail) =>
      deps.postGenerationProgress(panel, operation, phase, message, detail),
    resolveExistingDirectoryPath: (raw) => deps.resolveExistingDirectoryPath(raw),
    ensurePreExecDraftShell: (opts) => deps.ensurePreExecDraftShell(opts),
    finalizeDraftDefinition: (wf) => deps.finalizeDraftDefinition(wf),
    debugLog: (stageId, event, attempt, payload) => deps.debugLog(stageId, event, attempt, payload),
    warn: (msg) => deps.warn(msg),
    degraded: (reason, context) => deps.degraded(reason, context),
    invokeLlmRaw: (sys, user, panel, trace) => deps.invokeLlmRaw(sys, user, panel, trace),
    parseWorkflowJson: (raw, panel, onAux, maxOutputTokens) =>
      deps.parseWorkflowJson(raw, panel, onAux, maxOutputTokens),
    normalizeWorkflow: (wf, userInput, taskType) => deps.normalizeWorkflow(wf, userInput, taskType),
    isGenerationSuperseded: (myGen) => deps.isGenerationSuperseded(myGen),
    isRuntimeRule20VerifyEnabled: () => readEngineRuntimeRule20VerifyEnabled(),
    readGenerationGates: () => readEngineGenerationGates(),
    getMaxStageWarn: () => deps.maxStageWarn,
  };
}

export function buildStartExecutionHost(deps: StartExecutionHostDeps): StartExecutionHost {
  return {
    bindPanel: (panel) => deps.bindPanel(panel),
    postMessage: (panel, msg) => deps.postMessage(panel, msg),
    normalizeWorkflow: (wf, userInput, taskType) => deps.normalizeWorkflow(wf, userInput, taskType),
    resolveReuseInstance: (key) => deps.resolveReuseInstance(key),
    getCurrentInstanceKey: () => deps.getCurrentInstanceKey(),
    setCurrentInstanceKey: (key) => deps.setCurrentInstanceKey(key),
    getExecutionDepth: () => deps.getExecutionDepth(),
    getInstance: () => deps.getInstance(),
    setInstance: (instance) => deps.setInstance(instance),
    clearSaveTimer: () => deps.clearSaveTimer(),
    persistInstanceSnapshot: (key, inst) => deps.persistInstanceSnapshot(key, inst),
    resolveInitialTaskDirForStart: (id, wf) => deps.resolveInitialTaskDirForStart(id, wf),
    expandUserHomePath: (raw) => deps.expandUserHomePath(raw),
    clearExperiencePersistedFlag: () => deps.setExperiencePersistedForKey(undefined),
    debugLog: (stageId, event, attempt, payload) => deps.debugLog(stageId, event, attempt, payload),
    writeProcessDocs: (wf, taskDir) =>
      writeWorkflowProcessDocs(wf, taskDir, (raw) => deps.expandUserHomePath(raw), (msg) => deps.warn(msg)),
    persistMilestone: () => deps.persistMilestone(),
    scheduleSave: () => deps.scheduleSave(),
    executeNextStage: (panel) => deps.executeNextStage(panel),
  };
}

export function buildArtifactUiHost(deps: ArtifactUiHostDeps): ArtifactUiHost {
  return {
    getInstance: () => deps.getInstance(),
    getCurrentInstanceKey: () => deps.getCurrentInstanceKey(),
    resolveOutputPath: (key, fp, base) => deps.resolveOutputPath(key, fp, base),
    ensureTaskDir: (key) => deps.ensureTaskDir(key),
  };
}

export function buildResumeCoordinatorHost(deps: ResumeCoordinatorHostDeps): ResumeCoordinatorHost {
  return {
    bindPanel: (panel) => deps.bindPanel(panel),
    loadInstanceByKey: (key) => deps.loadInstanceByKey(key),
    postMessage: (panel, msg) => deps.postMessage(panel, msg),
    beginUiResync: () => deps.beginUiResync(),
    getInstance: () => deps.getInstance() as WorkflowInstance,
    getCurrentInstanceKey: () => deps.getCurrentInstanceKey(),
    setInstance: (instance) => deps.setInstance(instance),
    setCurrentInstanceKey: (key) => deps.setCurrentInstanceKey(key),
    getExecutionDepth: () => deps.getExecutionDepth(),
    clearSaveTimer: () => deps.clearSaveTimer(),
    persistInstanceSnapshot: (key, inst) => deps.persistInstanceSnapshot(key, inst),
    clearExperiencePersistedFlag: () => deps.setExperiencePersistedForKey(undefined),
    getDefaultTaskDir: (key) => deps.getDefaultTaskDir(key),
    debugLog: (stageId, event, attempt, payload) => deps.debugLog(stageId, event, attempt, payload),
    scheduleSave: () => deps.scheduleSave(),
    executeNextStage: (panel) => deps.executeNextStage(panel),
    warn: (msg) => deps.warn(msg),
  };
}

export function buildMessagingHost(deps: MessagingHostFactoryDeps): MessagingHost {
  return {
    getInstance: () => deps.getInstance(),
    getCurrentInstanceKey: () => deps.getCurrentInstanceKey(),
    getGlobalStorageFsPath: () =>
      deps.context.globalStorageUri?.fsPath ?? deps.context.storagePath ?? '',
    getExperiencePersistedForKey: () => deps.getExperiencePersistedForKey(),
    setExperiencePersistedForKey: (key) => deps.setExperiencePersistedForKey(key),
    warn: (msg) => deps.warn(msg),
    debugLog: (stageId, event, attempt, payload) => deps.debugLog(stageId, event, attempt, payload),
    logUserAction: (kind, detail) => deps.logUserAction(kind, detail),
    flushMetrics: (reason) => deps.flushMetrics?.(reason),
  };
}
