import type { Stage } from '../WorkflowDefinition';
import type { WebviewPanel } from './HostTypes';

/** 阶段执行 LLM 窄接口（替代 vscode `LlmClient`）。 */
export interface StageExecutionLlmPort {
  summarizeText(stageId: string, prompt: string): Promise<string>;
  executeStageLlm(
    stageId: string,
    systemPrompt: string,
    userContent: string,
    panel: WebviewPanel | undefined,
    stage?: Stage,
  ): Promise<string>;
}
