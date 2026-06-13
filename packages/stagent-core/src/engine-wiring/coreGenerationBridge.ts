import type { WorkflowEngineCore } from '../WorkflowEngineCore';
import type { EngineHostFactoryDeps } from '../engine-host';
import type { WorkflowInstanceManager } from '../WorkflowInstanceManager';
import { buildEngineHostFactoryDeps } from './buildEngineHostFactoryDeps';
import { buildHostExtensionContext } from './buildHostDepsFromPlatform';
import { platformConfirmDialog } from '../generation/confirmDialogAdapter';
import {
  WorkflowGenerationService,
  type WorkflowGenerationServiceHooks,
} from '../WorkflowGenerationService';
import { GenerationUiShim } from './GenerationUiShim';
import {
  normalizeWorkflow as normalizeWorkflowDefinition,
  parseWorkflowJson as parseWorkflowJsonFromRaw,
} from '../WorkflowGeneration';

export interface BootstrapGenerationHost {
  core: WorkflowEngineCore;
  instanceManager: WorkflowInstanceManager;
}

export function buildBootstrapHostFactoryDeps(
  host: BootstrapGenerationHost,
  getGenerationSeq: () => number,
  service?: WorkflowGenerationService,
): EngineHostFactoryDeps {
  const adapter = host.core.platformAccessor;
  const mgr = host.instanceManager;
  return buildEngineHostFactoryDeps({
    adapter,
    hostContext: buildHostExtensionContext(adapter),
    getGenerationSeq,
    overrides: {
      resolveExistingDirectoryPath: (raw) => host.core.resolveExistingDirectoryPathPublic(raw),
      ensurePreExecDraftShell: (opts) => mgr.draft.ensurePreExecDraftShell(opts),
      finalizeDraftDefinition: (wf) => mgr.draft.finalizeDraftDefinition(wf),
      invokeLlmRaw: (sys, user, _panel, trace, opts) =>
        host.core.invokeLlmRawPublic(sys, user, trace, opts),
      parseWorkflowJson: service
        ? async (raw, panel, onAux, maxOutputTokens) =>
            service.parseWorkflowJson(raw, panel, onAux, maxOutputTokens)
        : async (raw, _panel, onAux, maxOutputTokens) =>
            parseWorkflowJsonFromRaw(raw, {
              invokeLlmRaw: (systemPrompt, userContent, traceStageId, opts) =>
                host.core.invokeLlmRawPublic(systemPrompt, userContent, traceStageId, opts),
              onAuxLlmOutput: onAux,
              maxOutputTokens,
            }),
      normalizeWorkflow: service
        ? (wf, userInput, taskType) => service.normalizeWorkflow(wf, userInput, taskType)
        : (wf, userInput, taskType) =>
            normalizeWorkflowDefinition(wf, userInput, taskType, {
              pickZoomOutFilePath: (preferred) => host.core.pickZoomOutFilePathPublic(preferred),
            }),
      isGenerationSuperseded: service
        ? (myGen) => service.isGenerationSuperseded(myGen)
        : (myGen) => getGenerationSeq() !== myGen,
      getPolishCache: () => service!.getPolishCache(),
      polishCacheKey: (draft, taskType, polishTier) =>
        service!.polishCacheKey(draft, taskType, polishTier),
      rememberPolishCache: (key, text, at) => service!.rememberPolishCache(key, text, at),
      getInstance: () => mgr.instance,
      getCurrentInstanceKey: () => mgr.currentInstanceKey,
      setInstance: (inst) => {
        mgr.instance = inst;
      },
      setCurrentInstanceKey: (key) => {
        mgr.currentInstanceKey = key;
      },
      scheduleSave: () => mgr.persistence.scheduleSave(),
      debugLog: (stageId, event, attempt, payload) =>
        host.core.debugLogPublic(stageId, event, attempt, payload),
      degraded: (reason, context) => host.core.degradedPublic(reason, context),
      getGenerationSeq,
    },
  });
}

export function createGenerationService(host: BootstrapGenerationHost): WorkflowGenerationService {
  const ui = new GenerationUiShim((msg) => host.core.postMessage(msg));
  let service: WorkflowGenerationService;
  const hooks: WorkflowGenerationServiceHooks = {
    ui,
    confirmDialog: platformConfirmDialog(host.core.platformAccessor),
    hostFactoryDeps: () => buildBootstrapHostFactoryDeps(host, () => service.getGenerationSeq(), service),
    invokeLlmRaw: (sys, user, _panel, trace, opts) =>
      host.core.invokeLlmRawPublic(sys, user, trace, opts),
    pickZoomOutFilePath: (preferred) => host.core.pickZoomOutFilePathPublic(preferred),
    debugLog: (stageId, event, attempt, payload) =>
      host.core.debugLogPublic(stageId, event, attempt, payload),
    degraded: (reason, context) => host.core.degradedPublic(reason, context),
  };
  service = new WorkflowGenerationService(hooks);
  return service;
}

/** @deprecated 使用 buildBootstrapHostFactoryDeps */
export const buildCoreHostFactoryDeps = buildBootstrapHostFactoryDeps;
