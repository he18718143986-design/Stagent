import type { WorkflowDefinition } from '../WorkflowDefinition';
import { isLlmTextTool } from '../workflow/StageToolKinds';

/** 将 LLM 语义填充表写入各 stage 的 systemPrompt（骨架模板 Phase0 / M5）。 */
export function applySemanticFillToSkeleton(
  workflow: WorkflowDefinition,
  stagePrompts: Record<string, string>,
): WorkflowDefinition {
  if (!stagePrompts || Object.keys(stagePrompts).length === 0) {
    return workflow;
  }
  const stages = (workflow.stages ?? []).map((stage) => {
    const fill = stagePrompts[stage.id]?.trim();
    if (!fill || !isLlmTextTool(stage.tool) || stage.toolConfig.type !== 'llm-text') {
      return stage;
    }
    return {
      ...stage,
      toolConfig: {
        ...stage.toolConfig,
        systemPrompt: fill,
      },
    };
  });
  return { ...workflow, stages };
}
