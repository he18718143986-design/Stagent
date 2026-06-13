import type { Stage } from '../WorkflowDefinition';
import type { WebviewPanel } from '../platform/HostTypes';
import type { StageExecutionLlmPort } from '../platform/StageExecutionLlmPort';
import { CoreStageHostRegistry } from '../CoreStageHostRegistry';
import { EngineExecutionRunner } from '../EngineExecutionRunner';
import type { ExecutionRunnerInternalsHost } from '../ExecutionRunnerInternalsHost';
import type { WorkspaceLintContext } from '../WorkflowEngineWorkspaceLint';
import {
  readEngineGlossaryEnabled,
  readEnginePythonExportContractLintMode,
  readEnginePythonPypiSymbolLintMode,
  readEngineSdkPathContractLintMode,
} from '../WorkflowEngineSettingsReaders';
import type { ExecutionLoopParamsHost } from './buildExecutionLoopParams';

const AUTO_PANEL_STUB = {} as WebviewPanel;

function buildCoreLlmAdapter(host: ExecutionLoopParamsHost): StageExecutionLlmPort {
  return {
    summarizeText: (stageId, prompt) => host.executeLlmText(stageId, 'Summarize briefly.', prompt),
    executeStageLlm: (stageId, systemPrompt, userContent, panel, stage) => {
      const runtime = host.instance.stageRuntimes.find((r) => r.stageId === stageId);
      const augmented =
        stage && runtime
          ? host.augmentSystemPromptWithGlobalDecisions(stage, runtime, systemPrompt)
          : systemPrompt;
      return host.executeLlmText(stageId, augmented, userContent);
    },
  };
}

function buildWorkspaceLintContext(host: ExecutionLoopParamsHost): WorkspaceLintContext {
  return {
    instance: host.instance,
    workspaceRootAbsolute: host.getWorkspaceRootAbsolute(),
    glossaryEnabled: readEngineGlossaryEnabled(),
    sdkPathContractLintMode: readEngineSdkPathContractLintMode(),
    pythonExportContractLintMode: readEnginePythonExportContractLintMode(),
    pythonPypiSymbolLintMode: readEnginePythonPypiSymbolLintMode(),
  };
}

export function createCoreBinderRunner(
  loopHost: ExecutionLoopParamsHost,
  opts: {
    getExecutionDepth: () => number;
    setExecutionDepth: (depth: number) => void;
    getDefaultTaskDir: (instanceId: string) => string;
    workspaceFolderPath: () => string | undefined;
    persistMilestone: () => void;
  },
): EngineExecutionRunner {
  const registry = new CoreStageHostRegistry({
    getInstance: () => loopHost.instance,
    getCurrentInstanceKey: () => loopHost.currentInstanceKey,
    setCurrentInstanceKey: (key) => loopHost.setCurrentInstanceKey(key),
    scheduleSave: () => loopHost.scheduleSave(),
    persistMilestone: () => opts.persistMilestone(),
    postMessage: (_panel, msg) => loopHost.postMessage(msg),
    debugLog: (stageId, event, attempt, payload) =>
      loopHost.debugLog(stageId, event, attempt, payload),
    logUserAction: (kind, detail) => loopHost.logUserAction(kind, detail),
    warn: (message) => loopHost.warn(message),
    llm: buildCoreLlmAdapter(loopHost),
    getDefaultTaskDir: (id) => opts.getDefaultTaskDir(id),
    workspaceFolderPath: () => opts.workspaceFolderPath(),
    getWorkspaceRootAbsolute: () => loopHost.getWorkspaceRootAbsolute(),
    trackPersistedFile: (input) => loopHost.trackPersistedFile(input),
    workspaceLintContext: () => buildWorkspaceLintContext(loopHost),
  });

  const internalsHost: ExecutionRunnerInternalsHost = {
    ui: {
      bindPanel: () => {},
      getActivePanel: () => AUTO_PANEL_STUB,
    },
    instances: {
      lifecycle: {
        getInstance: () => loopHost.instance,
      },
    },
    diagnostics: {
      warn: (message) => loopHost.warn(message),
    },
    hostRegistry: registry,
    getExecutionDepth: () => opts.getExecutionDepth(),
    setExecutionDepth: (depth) => opts.setExecutionDepth(depth),
  };

  return new EngineExecutionRunner(internalsHost);
}

