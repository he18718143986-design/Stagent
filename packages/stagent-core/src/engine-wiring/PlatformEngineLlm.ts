import type { Stage } from '../WorkflowDefinition';
import type { WebviewPanel } from '../platform/HostTypes';
import type { EngineLlmPort } from '../platform/EngineLlmPort';
import type { WorkflowEngineCore } from '../WorkflowEngineCore';

/** 将 Core.invokeLlmRawPublic 适配为 EngineLlmPort（模块化门面路径）。 */
export function createPlatformEngineLlm(core: WorkflowEngineCore): EngineLlmPort {
  return {
    invokeRaw: (systemPrompt, userContent, _panel, traceStageId, opts) =>
      core.invokeLlmRawPublic(systemPrompt, userContent, traceStageId, opts),
    summarizeText: (stageId, prompt) =>
      core.invokeLlmRawPublic('Summarize briefly.', prompt, stageId),
    executeStageLlm: (stageId, systemPrompt, userContent, _panel, _stage) =>
      core.invokeLlmRawPublic(systemPrompt, userContent, stageId),
  };
}
