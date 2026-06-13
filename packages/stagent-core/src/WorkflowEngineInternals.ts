import type { HostExtensionContext, WebviewPanel } from './platform/HostTypes';
import type { EngineLlmPort } from './platform/EngineLlmPort';
import type { EngineHostFactoryDeps } from './WorkflowEngineHostFactories';
import { WorkflowEngineHostRegistry } from './WorkflowEngineHostRegistry';
import type { WorkflowEngineDiagnostics } from './WorkflowEngineDiagnostics';
import type { WorkflowGenerationService } from './WorkflowGenerationService';
import type { WorkflowInstanceManager } from './WorkflowInstanceManager';
import type { WorkflowUiBridge } from './WorkflowUiBridge';
import { EngineDiagnosticsOps } from './EngineDiagnosticsOps';
import { EngineExecutionRunner } from './EngineExecutionRunner';
import { EngineHostFactoryBuilder } from './EngineHostFactoryBuilder';
import type { EngineOutputChannel } from './engine-wiring/EngineRuntimeState';

export { type ExecutionRunnerInternalsHost } from './ExecutionRunnerInternalsHost';

export { MAX_STAGES_WARN } from './workflow/WorkflowLimits';

export interface WorkflowEngineInternalsHost {
  context: HostExtensionContext;
  instances: WorkflowInstanceManager;
  generation: WorkflowGenerationService;
  ui: WorkflowUiBridge;
  llm: EngineLlmPort;
  diagnostics: WorkflowEngineDiagnostics;
  hostRegistry: WorkflowEngineHostRegistry;
  getExecutionDepth(): number;
  setExecutionDepth(depth: number): void;
  getPreferredModelFamily(): string;
  getInstancesChangedListener(): (() => void) | undefined;
  getOutputChannelRef(): EngineOutputChannel | undefined;
  setOutputChannelRef(channel: EngineOutputChannel | undefined): void;
  workspaceFolderPath(): string | undefined;
}

export class WorkflowEngineInternals {
  private readonly diagnosticsOps: EngineDiagnosticsOps;
  private readonly hostFactoryBuilder: EngineHostFactoryBuilder;
  private readonly executionRunner: EngineExecutionRunner;
  private cachedHostFactoryDeps: EngineHostFactoryDeps | undefined;

  constructor(private readonly host: WorkflowEngineInternalsHost) {
    this.diagnosticsOps = new EngineDiagnosticsOps(host);
    this.hostFactoryBuilder = new EngineHostFactoryBuilder(host, this.diagnosticsOps);
    this.executionRunner = new EngineExecutionRunner(this.buildRunnerHost());
  }

  private buildRunnerHost() {
    const h = this.host;
    return {
      ui: {
        bindPanel: (panel?: WebviewPanel) => h.ui.bindPanel(panel),
        getActivePanel: () => h.ui.getActivePanel(),
      },
      instances: {
        lifecycle: {
          getInstance: () => h.instances.lifecycle.getInstance(),
        },
      },
      diagnostics: {
        warn: (message: string) => this.diagnosticsOps.warn(message),
      },
      hostRegistry: h.hostRegistry,
      getExecutionDepth: () => h.getExecutionDepth(),
      setExecutionDepth: (depth: number) => h.setExecutionDepth(depth),
    };
  }

  hostFactoryDeps(executeNextStage: (panel?: WebviewPanel) => Promise<void>): EngineHostFactoryDeps {
    if (!this.cachedHostFactoryDeps) {
      this.cachedHostFactoryDeps = this.hostFactoryBuilder.build(executeNextStage);
    }
    return this.cachedHostFactoryDeps;
  }

  getOutputChannel() {
    return this.diagnosticsOps.getOutputChannel();
  }

  warn(message: string): void {
    this.diagnosticsOps.warn(message);
  }

  degraded(reason: string, context?: Record<string, unknown>): void {
    this.diagnosticsOps.degraded(reason, context);
  }

  debugLog(stageId: string, event: string, attempt: number, payload?: unknown): void {
    this.diagnosticsOps.debugLog(stageId, event, attempt, payload);
  }

  ensureTaskDir(instanceKey: string): string {
    return this.diagnosticsOps.ensureTaskDir(instanceKey);
  }

  invokeLlmRaw(
    systemPrompt: string,
    userContent: string,
    panel: WebviewPanel,
    traceStageId: string,
    opts?: import('./core/LlmInvokeOpts').LlmInvokeOpts,
  ): Promise<string> {
    return this.diagnosticsOps.invokeLlmRaw(systemPrompt, userContent, panel, traceStageId, opts);
  }

  pickZoomOutFilePath(preferred?: string): string {
    return this.diagnosticsOps.pickZoomOutFilePath(preferred);
  }

  async runExecuteNextStageLoop(panel?: WebviewPanel): Promise<void> {
    return this.executionRunner.runExecuteNextStageLoop(panel);
  }
}
