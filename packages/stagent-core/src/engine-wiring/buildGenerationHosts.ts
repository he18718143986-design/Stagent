import type { EngineHostFactoryDeps } from '../engine-host';
import type { GenerationRunnerHost } from '../WorkflowGenerationRunner';
import type { PreGenerationHost } from '../WorkflowPreGenerationCoordinator';
import {
  readEngineGenerationGates,
  readEngineRuntimeRule20VerifyEnabled,
} from '../WorkflowEngineSettingsReaders';

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
    invokeLlmRaw: (sys, user, panel, trace, opts) => deps.invokeLlmRaw(sys, user, panel, trace, opts),
    warn: (msg) => deps.warn(msg),
    degraded: (reason, context) => deps.degraded(reason, context),
  };
}

export function buildGenerationRunnerHost(deps: EngineHostFactoryDeps): GenerationRunnerHost {
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
    invokeLlmRaw: (sys, user, panel, trace, opts) => deps.invokeLlmRaw(sys, user, panel, trace, opts),
    parseWorkflowJson: (raw, panel, onAux, maxOutputTokens) =>
      deps.parseWorkflowJson(raw, panel, onAux, maxOutputTokens),
    normalizeWorkflow: (wf, userInput, taskType) => deps.normalizeWorkflow(wf, userInput, taskType),
    isGenerationSuperseded: (myGen) => deps.getGenerationSeq() !== myGen,
    isRuntimeRule20VerifyEnabled: () => readEngineRuntimeRule20VerifyEnabled(),
    readGenerationGates: () => readEngineGenerationGates(),
    getMaxStageWarn: () => deps.maxStageWarn,
  };
}
