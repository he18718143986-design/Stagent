import type { StackProfile } from '../path-router/StackProfile';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { isLlmInfraStage } from './InfraStageRegistry';

export interface SanitizeInfraStagesResult {
  stages: Stage[];
  warnings: string[];
  discardedStageIds: string[];
}

/**
 * 丢弃 LLM 生成的 infra 阶段（不 block 计划）；bootstrap 将幂等重注入。
 */
export function sanitizeInfraStages(
  stages: Stage[],
  _stackProfile?: StackProfile,
): SanitizeInfraStagesResult {
  const warnings: string[] = [];
  const discardedStageIds: string[] = [];
  const next = stages.filter((s) => {
    if (!isLlmInfraStage(s)) {
      return true;
    }
    discardedStageIds.push(s.id);
    warnings.push(`llm_infra_stage_discarded:${s.id}`);
    return false;
  });
  return { stages: next, warnings, discardedStageIds };
}

export function sanitizeInfraStagesOnWorkflow(
  wf: WorkflowDefinition,
  stackProfile?: StackProfile,
): WorkflowDefinition & { planCompilerWarnings?: string[] } {
  const stages = Array.isArray(wf.stages) ? wf.stages : [];
  const { stages: nextStages, warnings } = sanitizeInfraStages(stages, stackProfile);
  if (warnings.length === 0) {
    return wf;
  }
  return {
    ...wf,
    stages: nextStages,
    planCompilerWarnings: [...(wf as { planCompilerWarnings?: string[] }).planCompilerWarnings ?? [], ...warnings],
  };
}
