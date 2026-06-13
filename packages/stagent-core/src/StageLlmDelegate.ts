import type * as vscode from './platform/HostTypes';
import type { PatchInstruction, Stage, StageRuntime } from './WorkflowDefinition';
import type { LlmClient } from './LlmClient';
import type { WorkflowEnginePathHost } from './WorkflowEnginePathHost';
import { primaryOutputKey } from './WorkflowInputContent';
import { StageInputResolutionService } from './StageInputResolutionService';
import type { WorkflowInstance } from './WorkflowDefinition';

export interface StageLlmDelegateDeps {
  getInstance: () => WorkflowInstance | undefined;
  getPathHost: () => WorkflowEnginePathHost;
  llm: LlmClient;
  warn: (message: string) => void;
  debugLog: (stageId: string, event: string, attempt: number, payload?: unknown) => void;
  postMessage: (panel: vscode.WebviewPanel | undefined, msg: import('./WorkflowDefinition').BackendMessage) => void;
  getWorkspaceRootAbsolute: () => string | undefined;
  logUserAction?: (kind: string, detail: Record<string, unknown>) => void;
}

/** 阶段执行：输入解析与 LLM / patch 调用。 */
export class StageLlmDelegate {
  private readonly inputResolution: StageInputResolutionService;

  constructor(private readonly deps: StageLlmDelegateDeps) {
    this.inputResolution = new StageInputResolutionService({
      getInstance: () => deps.getInstance(),
      getPathHost: () => deps.getPathHost(),
      llm: deps.llm,
      warn: (message) => deps.warn(message),
      debugLog: (stageId, event, attempt, payload) => deps.debugLog(stageId, event, attempt, payload),
      postMessage: (panel, msg) => deps.postMessage(panel, msg),
      getWorkspaceRootAbsolute: () => deps.getWorkspaceRootAbsolute(),
      logUserAction: (kind, detail) => deps.logUserAction?.(kind, detail),
    });
  }

  primaryOutputKey(stage: Stage): string {
    return primaryOutputKey(stage);
  }

  resolveInput(stage: Stage, runtime: StageRuntime, panel: vscode.WebviewPanel): Promise<string> {
    return this.inputResolution.resolveInput(stage, runtime, panel);
  }

  augmentSystemPromptWithGlobalDecisions(
    stage: Stage,
    runtime: StageRuntime,
    systemPrompt: string,
  ): string {
    return this.inputResolution.augmentSystemPromptWithGlobalDecisions(stage, runtime, systemPrompt);
  }

  executeLlmText(
    stageId: string,
    systemPrompt: string,
    userContent: string,
    panel: vscode.WebviewPanel,
  ): Promise<string> {
    const inst = this.deps.getInstance();
    const stage = inst?.definition.stages.find((s) => s.id === stageId);
    return this.deps.llm.executeStageLlm(stageId, systemPrompt, userContent, panel, stage);
  }

  applyPatchInstructions(
    instanceKey: string,
    instructions: PatchInstruction[],
    runtime: StageRuntime,
    outputKey: string,
  ): Promise<void> {
    return this.deps.getPathHost().applyPatchInstructions(instanceKey, instructions, runtime, outputKey);
  }
}
