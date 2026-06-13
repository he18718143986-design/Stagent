import type * as vscode from './platform/HostTypes';
import { executeNextStageLoopBridged } from './engine-wiring/coreExecutionBridge';
import { buildExecuteNextStageLoopParams } from './WorkflowEngineExecutionBinder';
import { WorkflowParallelMonitor } from './WorkflowParallelMonitor';
import type { ExecutionRunnerInternalsHost } from './ExecutionRunnerInternalsHost';

export class EngineExecutionRunner {
  constructor(private readonly host: ExecutionRunnerInternalsHost) {}

  beginExecutionDepth(): void {
    this.host.setExecutionDepth(this.host.getExecutionDepth() + 1);
  }

  endExecutionDepth(): void {
    this.host.setExecutionDepth(Math.max(0, this.host.getExecutionDepth() - 1));
  }

  async runExecuteNextStageLoop(panel?: vscode.WebviewPanel): Promise<void> {
    this.host.ui.bindPanel(panel);
    const targetPanel = panel ?? this.host.ui.getActivePanel();
    const instance = this.host.instances.lifecycle.getInstance();
    if (!instance) {
      this.host.diagnostics.warn('execute_loop_noop hasInstance=false');
      return;
    }
    const effectivePanel = targetPanel ?? this.host.ui.getActivePanel();
    if (!effectivePanel) {
      this.host.diagnostics.warn('execute_loop_noop hasPanel=false');
      return;
    }
    this.beginExecutionDepth();
    try {
      const parallelMonitor = new WorkflowParallelMonitor();
      await executeNextStageLoopBridged(
        buildExecuteNextStageLoopParams(
          this.host.hostRegistry.stageExecutionHost(),
          effectivePanel,
          parallelMonitor,
        ),
      );
    } finally {
      this.endExecutionDepth();
    }
  }
}
