import type { LlmInvokeOpts } from '../core/LlmInvokeOpts';
import type { Stage } from '../WorkflowDefinition';
import type { WebviewPanel } from './HostTypes';
import type { StageExecutionLlmPort } from './StageExecutionLlmPort';

/** 引擎内部 LLM 端口（阶段执行 + invokeRaw 生成路径）。 */
export interface EngineLlmPort extends StageExecutionLlmPort {
  invokeRaw(
    systemPrompt: string,
    userContent: string,
    panel: WebviewPanel,
    traceStageId: string,
    opts?: LlmInvokeOpts,
  ): Promise<string>;
  summarizeText(stageId: string, prompt: string): Promise<string>;
  executeStageLlm(
    stageId: string,
    systemPrompt: string,
    userContent: string,
    panel: WebviewPanel | undefined,
    stage?: Stage,
  ): Promise<string>;
}
