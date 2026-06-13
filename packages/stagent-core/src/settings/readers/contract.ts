import type { WorkspaceConfiguration } from '../../platform/HostTypes';
import { readConfigBooleanDefaultTrue, readConfigBooleanStrictTrue } from './readConfigHelpers';

export function readContractInfraChainV2Enabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanDefaultTrue(cfg, 'contract.infraChainV2');
}

export function readContractPlanPreflightV2Enabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'contract.planPreflightV2');
}

export function readContractCommitmentsEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'contract.commitments');
}

export function readContractCommitmentsLlmFallbackEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'contract.commitmentsLlmFallback');
}

export function readContractRuntimePreflightV2Enabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'contract.runtimePreflightV2');
}

export function readContractBoundExecutionEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'contract.boundExecution');
}

export function readContractDiagnosticRouterEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'contract.diagnosticRouter');
}

export function readContractSkeletonCompilerEnabled(cfg?: WorkspaceConfiguration): boolean {
  return readConfigBooleanStrictTrue(cfg, 'contract.skeletonCompiler');
}
