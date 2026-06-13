import type { WorkflowDefinition } from '../WorkflowDefinition';
import { SKELETON_PROMPT_PLACEHOLDER_PREFIX } from '../plan-skeleton/constants';
import { isLlmTextTool } from '../workflow/StageToolKinds';
import { planCompletenessMsg } from '../l10n/lintMsg';
import type { PlanCompletenessIssue } from './planCompletenessTypes';

/** 骨架模板展开后仍含占位前缀的 llm-text 阶段（语义填充未生效）。 */
export function lintSkeletonSemanticPlaceholder(wf: WorkflowDefinition): PlanCompletenessIssue[] {
  if (!wf.meta?.skeletonVersion) {
    return [];
  }
  const issues: PlanCompletenessIssue[] = [];
  for (const stage of wf.stages ?? []) {
    if (!isLlmTextTool(stage.tool) || stage.toolConfig.type !== 'llm-text') {
      continue;
    }
    const prompt = stage.toolConfig.systemPrompt ?? '';
    if (prompt.includes(SKELETON_PROMPT_PLACEHOLDER_PREFIX)) {
      issues.push({
        type: 'thin-llm-system-prompt',
        message: planCompletenessMsg(
          'thin-llm-system-prompt',
          `${stage.id} 仍含骨架占位前缀（语义填充未生效）`,
        ),
      });
    }
  }
  return issues;
}
