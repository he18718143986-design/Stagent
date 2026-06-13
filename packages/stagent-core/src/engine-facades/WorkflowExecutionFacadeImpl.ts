import type * as vscode from '../platform/HostTypes';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import type { FrontloadDecisionResolution } from '../decision-frontload/DecisionFrontloadTypes';
import type { WorkflowEngineExecutionFacade } from './WorkflowEngineFacades';
import type { WorkflowEngineHostRegistry } from '../WorkflowEngineHostRegistry';
import type { WorkflowEngineInternals } from '../WorkflowEngineInternals';
import type { WorkflowUiBridge } from '../WorkflowUiBridge';
import { startWorkflowExecution } from '../WorkflowStartCoordinator';

export interface WorkflowExecutionFacadeDeps {
  ui: WorkflowUiBridge;
  hostRegistry: WorkflowEngineHostRegistry;
  getInternals: () => WorkflowEngineInternals;
  getExecutionDepth: () => number;
  getPreferredModelFamily: () => string;
  setPreferredModelFamily: (modelFamily: string) => void;
}

export class WorkflowExecutionFacadeImpl implements WorkflowEngineExecutionFacade {
  constructor(private readonly deps: WorkflowExecutionFacadeDeps) {}

  startExecution(
    panel: vscode.WebviewPanel,
    workflowOverride?: WorkflowDefinition,
    instanceKey?: string,
    frontloadResolutions?: FrontloadDecisionResolution[],
  ): Promise<void> {
    return startWorkflowExecution(
      this.deps.hostRegistry.startExecutionHost(),
      panel,
      workflowOverride,
      instanceKey,
      frontloadResolutions,
    );
  }

  executeNextStage(panel?: vscode.WebviewPanel): Promise<void> {
    return this.deps.getInternals().runExecuteNextStageLoop(panel);
  }

  isExecutionInFlight(): boolean {
    return this.deps.getExecutionDepth() > 0;
  }

  getPreferredModelFamily(): string {
    return this.deps.getPreferredModelFamily();
  }

  setPreferredModelFamily(modelFamily: string): void {
    this.deps.setPreferredModelFamily(modelFamily);
  }

  getActivePanel(): vscode.WebviewPanel | undefined {
    return this.deps.ui.getActivePanel();
  }
}
