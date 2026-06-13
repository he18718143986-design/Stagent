import { showWarningToast } from './adapters/showWarningToast';
import { uiMsg } from './l10n/uiStrings';
import type { WebviewPanel } from './platform/HostTypes';
import type { ToolPathBase } from './WorkflowDefinition';
import { trackPersistedFileForInstance } from './WorkflowEngineArtifactBridge';
import { getOrCreateStagentOutputChannel } from './WorkflowEngineOutputHelper';
import type { WorkflowEngineInternalsHost } from './WorkflowEngineInternals';
import type { GenerationOperationId } from './generation/GenerationOperationIds';

export class EngineDiagnosticsOps {
  constructor(private readonly host: WorkflowEngineInternalsHost) {}

  getOutputChannel() {
    const channel = getOrCreateStagentOutputChannel(
      this.host.context,
      this.host.getOutputChannelRef(),
    );
    this.host.setOutputChannelRef(channel);
    return channel;
  }

  trackPersistedFile(input: {
    stageId: string;
    outputKey: string;
    filePath: string;
    content: string;
    existedBefore: boolean;
    priorContent?: string;
  }): void {
    trackPersistedFileForInstance(this.host.instances.lifecycle.getInstance(), input);
  }

  bindPanel(panel: WebviewPanel | undefined): void {
    this.host.ui.bindPanel(panel);
  }

  postGenerationProgress(
    panel: WebviewPanel,
    operation: GenerationOperationId,
    phase: 'preparing' | 'llm' | 'parsing' | 'validating',
    message: string,
    detail?: string,
  ): void {
    this.host.ui.postGenerationProgress(panel, operation, phase, message, detail);
  }

  markStageArtifactsApproved(stageId: string): void {
    this.host.ui.markStageArtifactsApproved(this.host.instances.lifecycle.getInstance(), stageId);
  }

  warn(message: string): void {
    this.host.diagnostics.warn(message);
  }

  degraded(reason: string, context?: Record<string, unknown>): void {
    this.host.diagnostics.degraded(reason, context);
  }

  debugLog(stageId: string, event: string, attempt: number, payload?: unknown): void {
    this.host.diagnostics.debugLog(stageId, event, attempt, payload);
  }

  error(message: string): void {
    this.host.diagnostics.error(message);
  }

  notifyInstancesChanged(): void {
    try {
      this.host.getInstancesChangedListener()?.();
    } catch (e) {
      this.warn(`instances_changed_listener_failed: ${String(e)}`);
    }
  }

  rejectApproveDecision(panel: WebviewPanel, stageId: string, reason: string): void {
    this.warn(`approveDecision_rejected stageId=${stageId} reason=${reason}`);
    void showWarningToast(uiMsg('stagent.warn.diagnostics', reason));
    this.host.ui.postMessage(panel, {
      type: 'actionHint',
      message: reason,
      stageId,
    });
  }

  workspaceFolderPath(): string | undefined {
    return this.host.workspaceFolderPath();
  }

  invokeLlmRaw(
    systemPrompt: string,
    userContent: string,
    panel: WebviewPanel,
    traceStageId: string,
    opts?: import('./core/LlmInvokeOpts').LlmInvokeOpts,
  ): Promise<string> {
    return this.host.llm.invokeRaw(systemPrompt, userContent, panel, traceStageId, opts);
  }

  pathHost() {
    return this.host.hostRegistry.pathHost();
  }

  ensureTaskDir(instanceKey: string): string {
    return this.pathHost().ensureTaskDir(instanceKey);
  }

  getWorkspaceRootAbsolute(): string | undefined {
    return this.pathHost().getWorkspaceRootAbsolute();
  }

  resolveOutputPath(instanceKey: string, filePath: string, base: ToolPathBase = 'instance'): string {
    return this.pathHost().resolveOutputPath(instanceKey, filePath, base);
  }

  pickZoomOutFilePath(preferred?: string): string {
    return this.pathHost().pickZoomOutFilePath(preferred);
  }
}
