import type * as vscode from '../platform/HostTypes';
import type {
  BackendMessage,
  CodeRunnerConfig,
  PatchInstruction,
  Stage,
  StageRuntime,
  ToolPathBase,
  WorkflowInstance,
} from '../WorkflowDefinition';
import type { SdkPathContractIssue } from '../SdkPathContractLint';

export type ExecutionMessagingHost = {
  instance: WorkflowInstance | undefined;
  currentInstanceKey: string | undefined;
  postMessage(panel: vscode.WebviewPanel | undefined, msg: BackendMessage): void;
  scheduleSave(): void;
  persistMilestone(): void;
  debugLog(stageId: string, event: string, attempt: number, payload?: unknown): void;
  warn?(message: string): void;
  isDebugVerbose(): boolean;
  logUserAction(kind: string, detail: Record<string, unknown>): void;
};

export type ExecutionLlmHost = {
  instance: WorkflowInstance | undefined;
  primaryOutputKey(stage: Stage): string;
  resolveInput(stage: Stage, runtime: StageRuntime, panel: vscode.WebviewPanel): Promise<string>;
  augmentSystemPromptWithGlobalDecisions(stage: Stage, runtime: StageRuntime, sys: string): string;
  executeLlmText(
    stageId: string,
    systemPrompt: string,
    userContent: string,
    panel: vscode.WebviewPanel,
  ): Promise<string>;
  applyPatchInstructions(
    instanceKey: string,
    instructions: PatchInstruction[],
    runtime: StageRuntime,
    outKey: string,
  ): Promise<void>;
};

export type ExecutionPathHost = {
  ensureTaskDir(instanceKey: string): string;
  resolveTaskFilePath(instanceKey: string, relativePath: string): string;
  resolveOutputPath(instanceKey: string, relativePath: string, base?: ToolPathBase): string;
  resolveReadableFilePath(instanceKey: string, relativePath: string): string;
  resolveDagMaxParallelismForInstance(): number;
  resolveCodeRunnerCwd(cfg: CodeRunnerConfig, instanceKey: string): string;
  trackPersistedFile(input: {
    stageId: string;
    outputKey: string;
    filePath: string;
    content: string;
    existedBefore: boolean;
    priorContent?: string;
  }): void;
};

export type ExecutionQualityHost = {
  getWorkspaceRootAbsolute(): string | undefined;
  runCodeRunner(
    cfg: CodeRunnerConfig,
    instanceKey: string,
    stageId: string,
    panel?: vscode.WebviewPanel,
    opts?: { deterministic?: boolean },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  runWorkspaceContractLint(): Promise<string[]>;
  runSdkPathContractHardGate(): Promise<SdkPathContractIssue | null>;
  runPythonExportContractHardGate(sliceSemantic?: string): Promise<
    import('../python-contract/PythonExportContractLint').PythonExportContractIssue | null
  >;
  runPythonPypiSymbolHardGate(): Promise<
    import('../python-contract/PythonPypiSymbolLint').PythonPypiSymbolIssue | null
  >;
};

/** 执行绑定层所需的引擎窄接口（由 WorkflowEngine / StageExecutionHost 在运行时满足）。 */
export type WorkflowEngineExecutionHost = ExecutionMessagingHost &
  ExecutionLlmHost &
  ExecutionPathHost &
  ExecutionQualityHost;

/** 质量门 Host 构建所需的最小引擎面（仍为宽 host 对象的类型收窄）。 */
export type QualityGateHostInput = ExecutionQualityHost &
  Pick<ExecutionMessagingHost, 'debugLog'> &
  Pick<ExecutionPathHost, 'resolveCodeRunnerCwd'>;
