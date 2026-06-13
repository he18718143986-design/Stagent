import type { WebviewPanel } from './platform/HostTypes';
import type { WorkflowInstance } from './WorkflowDefinition';
import type { WorkflowEngineExecutionHost } from './execution-bindings/types';

/** EngineExecutionRunner 所需窄宿主（Core binder 适配，无需完整 InstanceManager）。 */
export interface ExecutionRunnerInternalsHost {
  ui: {
    bindPanel(panel?: WebviewPanel): void;
    getActivePanel(): WebviewPanel | undefined;
  };
  instances: {
    lifecycle: {
      getInstance(): WorkflowInstance | undefined;
    };
  };
  diagnostics: {
    warn(message: string): void;
  };
  hostRegistry: {
    stageExecutionHost(): WorkflowEngineExecutionHost;
  };
  getExecutionDepth(): number;
  setExecutionDepth(depth: number): void;
}
