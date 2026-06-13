import type { ComplexityEstimate } from './WorkflowComplexityEstimator';
import type { Stage, WorkflowDefinition } from './WorkflowDefinition';

export const PLAN_STAGE_HARD_CAP = 50;

export interface PlanSummary {
  stageCount: number;
  /** 阶段硬上限（随对象传给 webview，避免内联函数引用模块级常量导致 `exports is not defined`）。 */
  stageHardCap: number;
  decisionStageCount: number;
  implStageCount: number;
  testRunStageCount: number;
  stageBudgetPercent: number;
  nearStageLimit: boolean;
  exceedsStageLimit: boolean;
  complexityTier?: string;
  estimatedImplModules?: number;
  dependencyEdgeCount: number;
  missingGlobalArchDecision: boolean;
  rule20ViolationCount: number;
  rule20WarningCount: number;
  implMissingDecisionSourceCount: number;
}

export interface StageSourceEdge {
  stageId: string;
  stageTitle: string;
  sourceType: string;
  refStageId?: string;
  outputKey?: string;
  label?: string;
  rule20D_ok?: boolean;
}

export interface PlanStageDiff {
  added: string[];
  removed: string[];
  unchanged: string[];
}

const MULTI_MODULE_HINT =
  /完整项目|多模块|全栈|端到端|管理系统|小程序|multiple\s+modules|full[\s-]?stack|full\s+project/i;

function isGlobalArchDecisionStage(stage: Stage): boolean {
  const id = stage.id.toLowerCase();
  const title = stage.title ?? '';
  return (
    stage.isDecisionStage === true &&
    (/architecture|arch_overview|global|全局|架构/.test(id) ||
      /全局|架构|architecture|overview/.test(title))
  );
}

function countRule20Tokens(warnings: string[] | undefined, prefix: string): number {
  if (!warnings?.length) {
    return 0;
  }
  return warnings.filter((w) => w.startsWith(prefix)).length;
}

function implMissingDecisionRecord(stage: Stage): boolean {
  if (!/^stage_impl_/.test(stage.id)) {
    return false;
  }
  const sources = stage.input?.sources ?? [];
  return !sources.some(
    (s) =>
      s.type === 'stage-output' &&
      s.outputKey === 'decisionRecord' &&
      typeof s.stageId === 'string' &&
      s.stageId.length > 0,
  );
}

export function buildPlanSummary(
  workflow: WorkflowDefinition,
  options?: {
    complexity?: ComplexityEstimate;
    warnings?: string[];
  },
): PlanSummary {
  const stages = workflow.stages ?? [];
  const decisionStageCount = stages.filter((s) => s.isDecisionStage).length;
  const implStageCount = stages.filter((s) => /^stage_impl_/.test(s.id)).length;
  const testRunStageCount = stages.filter((s) => /^stage_test_run_/.test(s.id)).length;
  const stageCount = stages.length;
  const userInput = workflow.meta?.userInput ?? '';
  const missingGlobalArchDecision =
    (workflow.meta?.taskType === 'software' || !workflow.meta?.taskType) &&
    (implStageCount > 5 || MULTI_MODULE_HINT.test(userInput)) &&
    !stages.some(isGlobalArchDecisionStage);

  let dependencyEdgeCount = 0;
  for (const st of stages) {
    for (const src of st.input?.sources ?? []) {
      if (src.type === 'stage-output' && src.stageId) {
        dependencyEdgeCount += 1;
      }
    }
  }

  const implMissingDecisionSourceCount = stages.filter(implMissingDecisionRecord).length;

  return {
    stageCount,
    stageHardCap: PLAN_STAGE_HARD_CAP,
    decisionStageCount,
    implStageCount,
    testRunStageCount,
    stageBudgetPercent: Math.min(100, Math.round((stageCount / PLAN_STAGE_HARD_CAP) * 100)),
    nearStageLimit: stageCount > 40 && stageCount <= PLAN_STAGE_HARD_CAP,
    exceedsStageLimit: stageCount > PLAN_STAGE_HARD_CAP,
    complexityTier: options?.complexity?.requiresGlobalArchitectureDecision
      ? 'multi-module-likely'
      : options?.complexity?.highHitlLikely
        ? 'hitl-likely'
        : 'standard',
    estimatedImplModules: options?.complexity?.estimatedImplModules,
    dependencyEdgeCount,
    missingGlobalArchDecision,
    rule20ViolationCount: countRule20Tokens(options?.warnings, 'rule20:'),
    rule20WarningCount: countRule20Tokens(options?.warnings, 'rule20-soft:'),
    implMissingDecisionSourceCount,
  };
}

export function buildStageSourceSummary(workflow: WorkflowDefinition): StageSourceEdge[] {
  const edges: StageSourceEdge[] = [];
  for (const st of workflow.stages) {
    const sources = st.input?.sources ?? [];
    if (sources.length === 0) {
      edges.push({
        stageId: st.id,
        stageTitle: st.title,
        sourceType: '(无 input.sources)',
      });
      continue;
    }
    for (const src of sources) {
      const edge: StageSourceEdge = {
        stageId: st.id,
        stageTitle: st.title,
        sourceType: src.type,
        refStageId: src.stageId,
        outputKey: src.outputKey,
        label: src.label,
      };
      if (/^stage_impl_/.test(st.id) && src.type === 'stage-output' && src.outputKey === 'decisionRecord') {
        edge.rule20D_ok = true;
      }
      edges.push(edge);
    }
    if (/^stage_impl_/.test(st.id) && !sources.some((s) => s.type === 'stage-output' && s.outputKey === 'decisionRecord')) {
      edges.push({
        stageId: st.id,
        stageTitle: st.title,
        sourceType: '⚠ Rule20-D',
        label: '缺少 decisionRecord 引用',
        rule20D_ok: false,
      });
    }
  }
  return edges;
}

export function formatPlanSummaryLines(summary: PlanSummary): string[] {
  const lines: string[] = ['—— 计划摘要（M20）——'];
  lines.push(`阶段：${summary.stageCount} / ${summary.stageHardCap}（${summary.stageBudgetPercent}%）`);
  lines.push(
    `决策 ${summary.decisionStageCount} · 实现 ${summary.implStageCount} · test_run ${summary.testRunStageCount}`,
  );
  if (summary.estimatedImplModules !== undefined) {
    lines.push(`预估 impl 模块：${summary.estimatedImplModules}（生成侧启发式）`);
  }
  lines.push(`依赖边（stage-output）：${summary.dependencyEdgeCount}`);
  if (summary.complexityTier) {
    lines.push(`复杂度档位：${summary.complexityTier}`);
  }
  if (summary.exceedsStageLimit) {
    lines.push('⚠ 阶段数超过 50 硬上限，建议削减或拆分需求');
  } else if (summary.nearStageLimit) {
    lines.push('⚠ 阶段数接近 50 上限');
  }
  if (summary.missingGlobalArchDecision) {
    lines.push('⚠ 疑似多模块任务，但未发现全局/架构类决策阶段');
  }
  if (summary.implMissingDecisionSourceCount > 0) {
    lines.push(`⚠ ${summary.implMissingDecisionSourceCount} 个 impl 阶段未引用 decisionRecord`);
  }
  if (summary.rule20ViolationCount > 0) {
    lines.push(`Rule20 结构违反：${summary.rule20ViolationCount}（M20.2 应已阻断生成）`);
  }
  if (summary.rule20WarningCount > 0) {
    lines.push(`Rule20 提示：${summary.rule20WarningCount}`);
  }
  return lines;
}

export function formatStageSourceSummaryLines(edges: StageSourceEdge[], stageId?: string): string[] {
  const filtered = stageId ? edges.filter((e) => e.stageId === stageId) : edges;
  if (filtered.length === 0) {
    return ['（无 input.sources 引用）'];
  }
  const lines: string[] = ['—— 输入来源 ——'];
  for (const e of filtered) {
    if (e.sourceType === '(无 input.sources)' || e.sourceType === '⚠ Rule20-D') {
      lines.push(`${e.stageId}: ${e.label ?? e.sourceType}`);
      continue;
    }
    const ref = e.refStageId
      ? `${e.refStageId}${e.outputKey ? `#${e.outputKey}` : ''}`
      : e.label ?? e.sourceType;
    const mark = e.rule20D_ok === false ? ' ⚠' : e.rule20D_ok ? ' ✓' : '';
    lines.push(`${e.stageId} ← ${e.sourceType}: ${ref}${mark}`);
  }
  return lines;
}

export function computePlanStageDiff(previousIds: string[], nextIds: string[]): PlanStageDiff {
  const prev = new Set(previousIds);
  const next = new Set(nextIds);
  const added = nextIds.filter((id) => !prev.has(id));
  const removed = previousIds.filter((id) => !next.has(id));
  const unchanged = nextIds.filter((id) => prev.has(id));
  return { added, removed, unchanged };
}

export function formatPlanStageDiffLines(diff: PlanStageDiff, hadPreviousPlan: boolean): string[] {
  if (!hadPreviousPlan) {
    return [];
  }
  const lines: string[] = ['—— 与上次生成对比 ——'];
  if (diff.added.length) {
    lines.push(`+ 新增 (${diff.added.length})：${diff.added.join(', ')}`);
  }
  if (diff.removed.length) {
    lines.push(`− 移除 (${diff.removed.length})：${diff.removed.join(', ')}`);
  }
  if (!diff.added.length && !diff.removed.length) {
    lines.push('阶段 id 列表与上次相同');
  }
  return lines;
}

export function isFirstDecisionStage(workflow: WorkflowDefinition, stageId: string): boolean {
  const first = workflow.stages.find((s) => s.isDecisionStage);
  return !!first && first.id === stageId;
}

export function shouldShowPlanReviewChecklist(
  workflow: WorkflowDefinition,
  stageId: string,
  warnings: string[] | undefined,
  planSummary?: PlanSummary,
): boolean {
  if (!isFirstDecisionStage(workflow, stageId)) {
    return false;
  }
  const w = warnings ?? [];
  if (
    w.some(
      (line) =>
        line.includes('software-missing-global-architecture-decision') ||
        line.includes('stage_count_exceeds_50') ||
        line.includes('stage_count_near_limit') ||
        line.includes('complexity:requires-global-architecture-decision'),
    )
  ) {
    return true;
  }
  if (planSummary?.missingGlobalArchDecision || planSummary?.exceedsStageLimit || planSummary?.nearStageLimit) {
    return true;
  }
  return false;
}

export function buildPlanReviewChecklistLines(
  workflow: WorkflowDefinition,
  planSummary?: PlanSummary,
  warnings?: string[],
): string[] {
  const lines: string[] = ['—— 计划补审（确认页无法细审的部分）——'];
  const userSnippet = (workflow.meta?.userInput ?? '').trim().slice(0, 200);
  if (userSnippet) {
    lines.push(`需求摘要：${userSnippet}${(workflow.meta?.userInput?.length ?? 0) > 200 ? '…' : ''}`);
  }
  lines.push(
    `决策阶段 ${planSummary?.decisionStageCount ?? '?'} 个 · 实现阶段 ${planSummary?.implStageCount ?? '?'} 个`,
  );
  if (planSummary?.missingGlobalArchDecision) {
    lines.push('□ 多模块/完整项目：是否缺少全局架构决策？');
  }
  if (planSummary?.nearStageLimit || planSummary?.exceedsStageLimit) {
    lines.push('□ 阶段预算：是否需削减 scope 或拆分任务？');
  }
  if ((warnings?.length ?? 0) > 0) {
    lines.push('□ 是否已阅读确认页 warnings？');
  }
  lines.push('□ 本模块边界是否符合需求？（在此决策清单中修正）');
  return lines;
}
