import type { CodebaseSnapshot } from './CodebaseContextProvider';

export interface ComplexityEstimate {
  estimatedImplModules: number;
  requiresGlobalArchitectureDecision: boolean;
  estimatedStageCount: number;
  exceedsHardCap: boolean;
  suggestedDecomposition?: string[];
  highHitlLikely: boolean;
}

const HARD_CAP_STAGES = 50;
const MULTI_MODULE_HINT =
  /完整项目|多模块|全栈|端到端|管理系统|小程序|multiple\s+modules|full[\s-]?stack|full\s+project/i;

function countImplHints(userInput: string): number {
  const modules = userInput.match(/模块|module|服务|service|页面|page|api/gi);
  return Math.max(1, modules?.length ?? 1);
}

export function estimateWorkflowComplexity(
  userInput: string,
  snapshot?: CodebaseSnapshot,
): ComplexityEstimate {
  const trimmed = userInput.trim();
  const implModulesFromInput = countImplHints(trimmed);
  const moduleCountFromSnapshot = snapshot?.existingModules.length ?? 0;
  const estimatedImplModules = Math.max(
    implModulesFromInput,
    Math.min(20, Math.ceil(moduleCountFromSnapshot / 5)),
  );

  const requiresGlobalArchitectureDecision =
    MULTI_MODULE_HINT.test(trimmed) || estimatedImplModules >= 5 || (snapshot?.existingModules.length ?? 0) > 25;

  const perModuleStages = 4;
  const baseStages = requiresGlobalArchitectureDecision ? 6 : 3;
  const estimatedStageCount = baseStages + estimatedImplModules * perModuleStages;
  const exceedsHardCap = estimatedStageCount > HARD_CAP_STAGES;

  const suggestedDecomposition: string[] = [];
  if (requiresGlobalArchitectureDecision) {
    suggestedDecomposition.push('stage_decide_architecture_overview');
  }
  for (let i = 0; i < Math.min(estimatedImplModules, 8); i += 1) {
    suggestedDecomposition.push(`stage_decide_slice_${i + 1}`);
    suggestedDecomposition.push(`stage_impl_slice_${i + 1}`);
  }

  const highHitlLikely = requiresGlobalArchitectureDecision || /人工|审核|HITL|手动确认/i.test(trimmed);

  return {
    estimatedImplModules,
    requiresGlobalArchitectureDecision,
    estimatedStageCount,
    exceedsHardCap,
    suggestedDecomposition: suggestedDecomposition.length > 0 ? suggestedDecomposition : undefined,
    highHitlLikely,
  };
}

export function complexityEstimateToWarningLines(estimate: ComplexityEstimate): string[] {
  const warnings: string[] = [];
  if (estimate.exceedsHardCap) {
    warnings.push(`complexity:exceeds-hard-cap:${estimate.estimatedStageCount}`);
  } else if (estimate.estimatedStageCount > 40) {
    warnings.push(`complexity:near-stage-limit:${estimate.estimatedStageCount}`);
  }
  if (estimate.requiresGlobalArchitectureDecision) {
    warnings.push('complexity:requires-global-architecture-decision:workflow');
  }
  if (estimate.highHitlLikely) {
    warnings.push('complexity:high-hitl-likely:workflow');
  }
  return warnings;
}

export function formatComplexityBlockForPrompt(estimate: ComplexityEstimate): string {
  return [
    '【复杂度预估（M17.5，仅供参考）】',
    `- 预估 impl 模块数：${estimate.estimatedImplModules}`,
    `- 预估阶段总数：${estimate.estimatedStageCount}${estimate.exceedsHardCap ? '（超过 50 硬上限，须削减或拆分）' : ''}`,
    `- 建议全局架构决策：${estimate.requiresGlobalArchitectureDecision ? '是' : '否'}`,
    estimate.suggestedDecomposition?.length
      ? `- 建议垂直切片骨架：${estimate.suggestedDecomposition.slice(0, 6).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
