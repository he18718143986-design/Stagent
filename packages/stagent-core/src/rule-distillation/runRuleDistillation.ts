import { analyzeFailurePatterns } from '../FailurePatternAnalyzer';
import { WorkflowExperienceStore } from '../WorkflowExperienceStore';
import { CandidateRuleStore } from './CandidateRuleStore';
import type { CandidateRule } from './CandidateRuleTypes';
import { distillCandidateRules } from './distillCandidateRules';
import {
  promoteCandidateRules,
  type PromotionThresholds,
} from './promoteCandidateRules';

/** 离线 CLI 默认：不可达阈值，显式保证零自动晋升（serves=0 永远 < minServes）。 */
export const OFFLINE_NO_AUTO_PROMOTE_THRESHOLDS: PromotionThresholds = {
  minServes: 9999,
  minAcceptanceRate: 1,
};

export interface RunRuleDistillationOptions {
  experienceStorePath: string;
  candidateStorePath: string;
  thresholds?: PromotionThresholds;
  minFrequency?: number;
  now?: () => string;
}

export interface RunRuleDistillationSummary {
  total: number;
  byStatus: Record<string, number>;
  /** 本次 distill 前 store 中不存在 id 的 needs_review 候选 */
  newIds: string[];
}

export interface RunRuleDistillationResult {
  distilled: CandidateRule[];
  summary: RunRuleDistillationSummary;
}

function countByStatus(rules: CandidateRule[]): Record<string, number> {
  const byStatus: Record<string, number> = {};
  for (const rule of rules) {
    byStatus[rule.status] = (byStatus[rule.status] ?? 0) + 1;
  }
  return byStatus;
}

/**
 * 离线提炼编排：experiences → 失败聚类 → 候选规则 store。
 * 仅用于 CLI / 测试；不接入 live 引擎运行时。
 */
export function runRuleDistillation(opts: RunRuleDistillationOptions): RunRuleDistillationResult {
  const now = opts.now;
  const experienceStore = new WorkflowExperienceStore(opts.experienceStorePath);
  const experiences = experienceStore.readAll();
  const report = analyzeFailurePatterns(experiences);

  const candidateStore = new CandidateRuleStore(opts.candidateStorePath);
  const existing = candidateStore.readAll();
  const existingIds = new Set(existing.map((r) => r.id));

  const distilled = distillCandidateRules(report, existing, {
    minFrequency: opts.minFrequency,
    now,
  });

  const newIds = distilled
    .filter((r) => !existingIds.has(r.id))
    .map((r) => r.id);

  const promoted = promoteCandidateRules(
    distilled,
    opts.thresholds ?? OFFLINE_NO_AUTO_PROMOTE_THRESHOLDS,
    now,
  );

  candidateStore.writeAll(promoted);

  return {
    distilled: promoted,
    summary: {
      total: promoted.length,
      byStatus: countByStatus(promoted),
      newIds,
    },
  };
}

/** CLI / 测试用：按 status 分组打印候选规则摘要。 */
export function formatCandidateRuleDistillationSummary(
  rules: CandidateRule[],
  summary: RunRuleDistillationSummary,
): string {
  const lines: string[] = [
    '## Candidate rules (distillation)',
    `Total: ${summary.total}`,
    `New needs_review ids: ${summary.newIds.length > 0 ? summary.newIds.join(', ') : '(none)'}`,
    'By status:',
  ];
  for (const [status, count] of Object.entries(summary.byStatus).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    lines.push(`- ${status}: ${count}`);
  }
  const needsReview = rules.filter((r) => r.status === 'needs_review');
  if (needsReview.length > 0) {
    lines.push('', '### needs_review');
    for (const rule of needsReview) {
      lines.push(`- ${rule.id} [${rule.kind}] hits=${rule.hits}: ${rule.message}`);
    }
  }
  return lines.join('\n');
}
