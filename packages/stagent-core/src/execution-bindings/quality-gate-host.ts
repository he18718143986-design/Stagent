import type * as vscode from '../platform/HostTypes';
import type { QualityGateExecutionHost } from '../quality-gate/QualityGateExecutionHost';
import {
  analysisResultsToWarningLines,
  buildDefaultWorkspaceChecks,
  runStaticAnalysis,
} from '../StaticAnalysisPipeline';
import type { QualityGateHostInput } from './types';
import { getStagentConfiguration } from '../settings/getStagentConfiguration';
import { qualityGateSettingsReaders } from './quality-gate-settings';

export function buildQualityGateExecutionHost(
  engine: QualityGateHostInput,
  targetPanel: vscode.WebviewPanel,
): QualityGateExecutionHost {
  const cfg = getStagentConfiguration();
  const readers = qualityGateSettingsReaders;
  return {
    getWorkspaceRootAbsolute: () => engine.getWorkspaceRootAbsolute(),
    resolveCodeRunnerCwd: (cfg, instanceKey) => engine.resolveCodeRunnerCwd(cfg, instanceKey),
    runCodeRunner: (cfg, instanceKey, stageId) =>
      engine.runCodeRunner(cfg, instanceKey, stageId, targetPanel),
    runWorkspaceContractLint: () => engine.runWorkspaceContractLint(),
    runSdkPathContractHardGate: () => engine.runSdkPathContractHardGate(),
    runPythonExportContractHardGate: (sliceSemantic?: string) =>
      engine.runPythonExportContractHardGate(sliceSemantic),
    runPythonPypiSymbolHardGate: () => engine.runPythonPypiSymbolHardGate(),
    runPostImplStaticAnalysis: async () => {
      if (!readers.readStaticAnalysisEnabled(cfg)) {
        return [];
      }
      const ws = engine.getWorkspaceRootAbsolute();
      if (!ws) {
        return [];
      }
      const checks = buildDefaultWorkspaceChecks(ws);
      if (checks.length === 0) {
        return [];
      }
      const results = await runStaticAnalysis(checks, ws);
      return analysisResultsToWarningLines(results);
    },
    readRedGreenGateMode: () => readers.readRedGreenGateMode(cfg),
    readDebugFeedbackLoopRuntimeHard: () => readers.readDebugFeedbackLoopRuntimeHard(cfg),
    readTestRunPreflightEnabled: () => readers.readTestRunPreflightEnabled(cfg),
    readTestRunAutoNpmInstallEnabled: () => readers.readTestRunAutoNpmInstallEnabled(cfg),
    readSdkPathContractLintMode: () => readers.readSdkPathContractLintMode(cfg),
    readPythonExportContractLintMode: () => readers.readPythonExportContractLintMode(cfg),
    readPythonModuleContractLintMode: () => readers.readPythonModuleContractLintMode(cfg),
    readTestQualityLintMode: () => readers.readTestQualityLintMode(cfg),
    readBehaviorSpecLintMode: () => readers.readBehaviorSpecLintMode(cfg),
    readDemoArtifactLintMode: () => readers.readDemoArtifactLintMode(cfg),
    readPythonPypiSymbolLintMode: () => readers.readPythonPypiSymbolLintMode(cfg),
    readStaticAnalysisEnabled: () => readers.readStaticAnalysisEnabled(cfg),
  };
}
