import type { WebviewPanel } from './platform/HostTypes';
import type { EngineHostFactoryDeps } from './WorkflowEngineHostFactories';
import { expandUserHomePath, resolveExistingDirectoryPath } from './WorkflowPathResolver';
import {
  getDefaultTaskDir as getDefaultTaskDirFromRepo,
  loadInstanceByKey as loadInstanceByKeyFromRepo,
  resolveInitialTaskDirForStart as resolveInitialTaskDirForStartFromRepo,
} from './WorkflowInstanceRepository';
import type { EngineDiagnosticsOps } from './EngineDiagnosticsOps';
import type { WorkflowEngineInternalsHost } from './WorkflowEngineInternals';
import { MAX_STAGES_WARN } from './workflow/WorkflowLimits';

export { MAX_STAGES_WARN } from './workflow/WorkflowLimits';

export class EngineHostFactoryBuilder {
  constructor(
    private readonly host: WorkflowEngineInternalsHost,
    private readonly diagnostics: EngineDiagnosticsOps,
  ) {}

  build(executeNextStage: (panel?: WebviewPanel) => Promise<void>): EngineHostFactoryDeps {
    const h = this.host;
    const d = this.diagnostics;
    return {
      context: h.context,
      getInstance: () => h.instances.lifecycle.getInstance(),
      setInstance: (instance) => {
        h.instances.instance = instance;
      },
      getCurrentInstanceKey: () => h.instances.lifecycle.getActiveInstanceKey(),
      setCurrentInstanceKey: (key) => {
        h.instances.currentInstanceKey = key;
      },
      getExecutionDepth: () => h.getExecutionDepth(),
      getExperiencePersistedForKey: () => h.instances.experiencePersistedForKey,
      setExperiencePersistedForKey: (key) => {
        h.instances.experiencePersistedForKey = key;
      },
      getPolishCache: () => h.generation.getPolishCache(),
      getGenerationSeq: () => h.generation.getGenerationSeq(),
      clearSaveTimer: () => h.instances.persistence.clearSaveTimer(),
      bindPanel: (panel) => h.ui.bindPanel(panel),
      postMessage: (panel, msg) => h.ui.postMessage(panel, msg),
      beginUiResync: () => {
        h.ui.beginUiResync();
      },
      postGenerationProgress: (panel, operation, phase, message, detail) =>
        h.ui.postGenerationProgress(panel, operation, phase, message, detail),
      warn: (message) => d.warn(message),
      degraded: (reason, context) => d.degraded(reason, context),
      error: (message) => d.error(message),
      debugLog: (stageId, event, attempt, payload) => d.debugLog(stageId, event, attempt, payload),
      logUserAction: (kind, detail) => h.diagnostics.logUserAction(kind, detail),
      flushMetrics: (reason) => h.diagnostics.flushMetrics(reason),
      scheduleSave: () => h.instances.persistence.scheduleSave(),
      persistMilestone: () => h.instances.persistence.persistMilestone(),
      persistInstanceSnapshot: (key, inst) => h.instances.persistence.persistInstanceSnapshot(key, inst),
      notifyInstancesChanged: () => d.notifyInstancesChanged(),
      workspaceFolderPath: () => d.workspaceFolderPath(),
      resolveExistingDirectoryPath: (raw) => resolveExistingDirectoryPath(raw),
      expandUserHomePath: (raw) => expandUserHomePath(raw),
      getDefaultTaskDir: (id) => getDefaultTaskDirFromRepo(h.instances.persistence.instanceRepoContext(), id),
      resolveInitialTaskDirForStart: (id, wf) =>
        resolveInitialTaskDirForStartFromRepo(h.instances.persistence.instanceRepoContext(), id, wf),
      loadInstanceByKey: (key) => loadInstanceByKeyFromRepo(h.instances.persistence.instanceRepoContext(), key),
      deleteInstance: (key, scope) => h.instances.catalog.deleteInstance(key, scope),
      resolveReuseInstance: (key) => h.instances.catalog.resolveReuseInstance(key),
      ensurePreExecDraftShell: (opts) => h.instances.draft.ensurePreExecDraftShell(opts),
      finalizeDraftDefinition: (wf) => h.instances.draft.finalizeDraftDefinition(wf),
      rejectApproveDecision: (panel, stageId, reason) => d.rejectApproveDecision(panel, stageId, reason),
      executeNextStage,
      invokeLlmRaw: (sys, user, panel, trace) => d.invokeLlmRaw(sys, user, panel, trace),
      parseWorkflowJson: (raw, panel, onAux, maxOutputTokens) =>
        h.generation.parseWorkflowJson(raw, panel, onAux, maxOutputTokens),
      normalizeWorkflow: (wf, userInput, taskType) =>
        h.generation.normalizeWorkflow(wf, userInput, taskType),
      isGenerationSuperseded: (myGen) => h.generation.isGenerationSuperseded(myGen),
      polishCacheKey: (draft, taskType, polishTier) =>
        h.generation.polishCacheKey(draft, taskType, polishTier),
      rememberPolishCache: (cacheKey, text, polishedAt) =>
        h.generation.rememberPolishCache(cacheKey, text, polishedAt),
      markStageArtifactsApproved: (stageId) => d.markStageArtifactsApproved(stageId),
      getWorkspaceRootAbsolute: () => d.getWorkspaceRootAbsolute(),
      resolveOutputPath: (key, fp, base) => d.resolveOutputPath(key, fp, base),
      ensureTaskDir: (key) => d.ensureTaskDir(key),
      trackPersistedFile: (input) => d.trackPersistedFile(input),
      maxStageWarn: MAX_STAGES_WARN,
    };
  }
}
