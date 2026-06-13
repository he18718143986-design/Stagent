import type { WorkflowEngine } from '../WorkflowEngine';
import type { WorkflowPanelFactory } from '../WorkflowPanelFactory';

export interface ExtensionRuntime {
  engine: WorkflowEngine;
  panelFactory: WorkflowPanelFactory;
  refreshAiControls: () => void;
}

export function createExtensionRuntime(
  engine: WorkflowEngine,
  panelFactory: WorkflowPanelFactory,
  refreshAiControls: () => void,
): ExtensionRuntime {
  return { engine, panelFactory, refreshAiControls };
}
