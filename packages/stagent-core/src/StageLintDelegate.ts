import type { SdkPathContractIssue } from './SdkPathContractLint';
import type { PythonExportContractIssue } from './python-contract/PythonExportContractLint';
import type { PythonPypiSymbolIssue } from './python-contract/PythonPypiSymbolLint';
import type { WorkspaceLintContext } from './WorkflowEngineWorkspaceLint';
import {
  runPythonExportContractHardGate as runPythonExportContractHardGateFromLint,
  runPythonPypiSymbolHardGate as runPythonPypiSymbolHardGateFromLint,
  runSdkPathContractHardGate as runSdkPathContractHardGateFromLint,
  runWorkspaceContractLint as runWorkspaceContractLintFromLint,
} from './WorkflowEngineWorkspaceLint';

export interface StageLintDelegateDeps {
  workspaceLintContext: () => WorkspaceLintContext;
}

export class StageLintDelegate {
  constructor(private readonly deps: StageLintDelegateDeps) {}

  runWorkspaceContractLint(): Promise<string[]> {
    return runWorkspaceContractLintFromLint(this.deps.workspaceLintContext());
  }

  runSdkPathContractHardGate(): Promise<SdkPathContractIssue | null> {
    return runSdkPathContractHardGateFromLint(this.deps.workspaceLintContext());
  }

  runPythonExportContractHardGate(sliceSemantic?: string): Promise<PythonExportContractIssue | null> {
    return runPythonExportContractHardGateFromLint(this.deps.workspaceLintContext(), {
      sliceSemantic,
    });
  }

  runPythonPypiSymbolHardGate(): Promise<PythonPypiSymbolIssue | null> {
    return runPythonPypiSymbolHardGateFromLint(this.deps.workspaceLintContext());
  }
}
