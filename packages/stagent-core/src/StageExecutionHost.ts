/**
 * StageExecutionHost — 阶段执行能力宿主（从 WorkflowEngine 抽出，供 ExecutionBinder 使用）。
 */
import type * as vscode from './platform/HostTypes';
import type { BackendMessage, WorkflowInstance } from './WorkflowDefinition';
import type { WorkflowEngineExecutionHost } from './execution-bindings/types';
import type { WorkspaceLintContext } from './WorkflowEngineWorkspaceLint';
import { trackPersistedFileForInstance } from './WorkflowEngineArtifactBridge';
import type { LlmClient } from './LlmClient';
import type { WorkflowEnginePathHost } from './WorkflowEnginePathHost';
import { StageCodeRunnerService } from './StageCodeRunnerService';
import { StagePathDelegate } from './StagePathDelegate';
import { StageLintDelegate } from './StageLintDelegate';
import { StageMessagingDelegate } from './StageMessagingDelegate';
import { StageLlmDelegate } from './StageLlmDelegate';
import { readEngineDagMaxParallelism } from './WorkflowEngineSettingsReaders';

type PathHost = WorkflowEnginePathHost;

export interface StageExecutionHostDeps {
  getInstance: () => WorkflowInstance | undefined;
  getCurrentInstanceKey: () => string | undefined;
  setCurrentInstanceKey: (key: string | undefined) => void;
  scheduleSave: () => void;
  persistMilestone: () => void;
  postMessage: (panel: vscode.WebviewPanel | undefined, msg: BackendMessage) => void;
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void;
  logUserAction: (kind: string, detail: Record<string, unknown>) => void;
  warn: (message: string) => void;
  llm: LlmClient;
  getPathHost: () => PathHost;
  workspaceLintContext: () => WorkspaceLintContext;
}

export type StageExecutionHost = WorkflowEngineExecutionHost;

export function createStageExecutionHost(deps: StageExecutionHostDeps): WorkflowEngineExecutionHost {
  const messaging = new StageMessagingDelegate({
    postMessage: (panel, msg) => deps.postMessage(panel, msg),
    scheduleSave: () => deps.scheduleSave(),
    persistMilestone: () => deps.persistMilestone(),
    debugLog: (stageId, event, attempt, payload) => deps.debugLog(stageId, event, attempt, payload),
    warn: (message) => deps.warn(message),
    logUserAction: (kind, detail) => deps.logUserAction(kind, detail),
  });
  const llmStage = new StageLlmDelegate({
    getInstance: () => deps.getInstance(),
    getPathHost: () => deps.getPathHost(),
    llm: deps.llm,
    warn: (message) => deps.warn(message),
    debugLog: (stageId, event, attempt, payload) => deps.debugLog(stageId, event, attempt, payload),
    postMessage: (panel, msg) => deps.postMessage(panel, msg),
    getWorkspaceRootAbsolute: () => deps.getPathHost().getWorkspaceRootAbsolute(),
    logUserAction: (kind, detail) => deps.logUserAction(kind, detail),
  });
  const codeRunner = new StageCodeRunnerService({
    getPathHost: () => deps.getPathHost(),
    postMessage: (panel, msg) => deps.postMessage(panel, msg),
    warn: (message) => deps.warn(message),
  });
  const pathDelegate = new StagePathDelegate({
    getPathHost: () => deps.getPathHost(),
    getInstance: () => deps.getInstance(),
    readDagMaxParallelism: readEngineDagMaxParallelism,
  });
  const lintDelegate = new StageLintDelegate({
    workspaceLintContext: () => deps.workspaceLintContext(),
  });

  const host: WorkflowEngineExecutionHost = {
    postMessage: (panel, msg) => messaging.postMessage(panel, msg),
    scheduleSave: () => messaging.scheduleSave(),
    persistMilestone: () => messaging.persistMilestone(),
    debugLog: (stageId, event, attempt, payload) => messaging.debugLog(stageId, event, attempt, payload),
    warn: (message) => messaging.warn(message),
    isDebugVerbose: () => messaging.isDebugVerbose(),
    logUserAction: (kind, detail) => messaging.logUserAction(kind, detail),
    primaryOutputKey: (stage) => llmStage.primaryOutputKey(stage),
    resolveInput: (stage, runtime, panel) => llmStage.resolveInput(stage, runtime, panel),
    augmentSystemPromptWithGlobalDecisions: (stage, runtime, systemPrompt) =>
      llmStage.augmentSystemPromptWithGlobalDecisions(stage, runtime, systemPrompt),
    executeLlmText: (stageId, systemPrompt, userContent, panel) =>
      llmStage.executeLlmText(stageId, systemPrompt, userContent, panel),
    applyPatchInstructions: (instanceKey, instructions, runtime, outputKey) =>
      llmStage.applyPatchInstructions(instanceKey, instructions, runtime, outputKey),
    ensureTaskDir: (instanceKey) => pathDelegate.ensureTaskDir(instanceKey),
    resolveTaskFilePath: (instanceKey, filePath) => pathDelegate.resolveTaskFilePath(instanceKey, filePath),
    resolveOutputPath: (instanceKey, filePath, base) =>
      pathDelegate.resolveOutputPath(instanceKey, filePath, base),
    resolveReadableFilePath: (instanceKey, filePath) =>
      pathDelegate.resolveReadableFilePath(instanceKey, filePath),
    resolveDagMaxParallelismForInstance: () => pathDelegate.resolveDagMaxParallelismForInstance(),
    resolveCodeRunnerCwd: (cfg, instanceKey) => codeRunner.resolveCodeRunnerCwd(cfg, instanceKey),
    trackPersistedFile: (input) => trackPersistedFileForInstance(deps.getInstance(), input),
    getWorkspaceRootAbsolute: () => pathDelegate.getWorkspaceRootAbsolute(),
    runCodeRunner: (cfg, instanceKey, stageId, panel) =>
      codeRunner.runCodeRunner(cfg, instanceKey, stageId, panel),
    runWorkspaceContractLint: () => lintDelegate.runWorkspaceContractLint(),
    runSdkPathContractHardGate: () => lintDelegate.runSdkPathContractHardGate(),
    runPythonExportContractHardGate: (sliceSemantic?: string) =>
      lintDelegate.runPythonExportContractHardGate(sliceSemantic),
    runPythonPypiSymbolHardGate: () => lintDelegate.runPythonPypiSymbolHardGate(),
    get instance(): WorkflowInstance | undefined {
      return deps.getInstance();
    },
    get currentInstanceKey(): string | undefined {
      return deps.getCurrentInstanceKey();
    },
    set currentInstanceKey(key: string | undefined) {
      deps.setCurrentInstanceKey(key);
    },
  };

  return host;
}
