import type { CodeRunnerConfig } from '../WorkflowDefinition';
import type { SdkPathContractIssue } from '../SdkPathContractLint';
import type { PythonExportContractIssue } from '../python-contract/PythonExportContractLint';
import type { PythonPypiSymbolIssue } from '../python-contract/PythonPypiSymbolLint';

export type { PythonExportContractIssue, PythonPypiSymbolIssue };

/** 执行期 gate 评估所需的引擎能力（窄接口，便于单测 mock）。 */
export interface QualityGateExecutionHost {
  getWorkspaceRootAbsolute(): string | undefined;
  resolveCodeRunnerCwd(cfg: CodeRunnerConfig, instanceKey: string): string;
  runCodeRunner(
    cfg: CodeRunnerConfig,
    instanceKey: string,
    stageId: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  runWorkspaceContractLint(): Promise<string[]>;
  runSdkPathContractHardGate(): Promise<SdkPathContractIssue | null>;
  runPythonExportContractHardGate(sliceSemantic?: string): Promise<PythonExportContractIssue | null>;
  runPythonPypiSymbolHardGate(): Promise<PythonPypiSymbolIssue | null>;
  runPostImplStaticAnalysis(): Promise<string[]>;
  readRedGreenGateMode(): 'off' | 'warn' | 'hard';
  readDebugFeedbackLoopRuntimeHard(): boolean;
  readTestRunPreflightEnabled(): boolean;
  readTestRunAutoNpmInstallEnabled(): boolean;
  readSdkPathContractLintMode(): 'off' | 'warn' | 'hard';
  readPythonExportContractLintMode(): 'off' | 'warn' | 'hard';
  readPythonModuleContractLintMode(): 'off' | 'warn' | 'hard';
  readTestQualityLintMode(): 'off' | 'warn' | 'hard';
  readBehaviorSpecLintMode(): 'off' | 'warn' | 'hard';
  readDemoArtifactLintMode(): 'off' | 'warn' | 'hard';
  readPythonPypiSymbolLintMode(): 'off' | 'warn' | 'hard';
  readStaticAnalysisEnabled(): boolean;
}
