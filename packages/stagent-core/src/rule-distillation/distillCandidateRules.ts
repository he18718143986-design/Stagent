import type { FailureAnalysisReport } from '../FailurePatternAnalyzer';
import type { CandidateRule } from './CandidateRuleTypes';

/** id 最大长度（sanitize 后截断，保留可读性同时避免无界增长） */
const MAX_ID_LENGTH = 80;

export interface DistillCandidateRulesOptions {
  minFrequency?: number;
  now?: () => string;
}

/** 把 patternId 派生为稳定、文件名安全的候选规则 id。 */
export function candidateRuleId(patternId: string): string {
  const sanitized = patternId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, MAX_ID_LENGTH);
  return `cr_${sanitized}`;
}

/**
 * 从失败分析报告提炼候选规则。
 *
 * - 仅处理 `frequency >= (minFrequency ?? 2)` 的 pattern。
 * - 新建项：status=needs_review，hits=frequency，serves=0，acceptanceRate=0，
 *   message=recommendation，createdAt=updatedAt=now。
 * - 已存在（同 id）：保留 status/acceptanceRate/serves/createdAt，更新
 *   hits=frequency、updatedAt，并合并 sourcePatternIds。
 * - 返回合并后的全量列表（按 hits 降序、再按 id 升序稳定排序）。
 */
export function distillCandidateRules(
  report: FailureAnalysisReport,
  existing: CandidateRule[],
  opts?: DistillCandidateRulesOptions,
): CandidateRule[] {
  const minFrequency = opts?.minFrequency ?? 2;
  const nowFn = opts?.now ?? (() => new Date().toISOString());

  const byId = new Map<string, CandidateRule>();
  for (const rule of existing) {
    byId.set(rule.id, { ...rule, sourcePatternIds: [...rule.sourcePatternIds] });
  }

  for (const pattern of report.patterns) {
    if (pattern.frequency < minFrequency) {
      continue;
    }
    const id = candidateRuleId(pattern.patternId);
    const now = nowFn();
    const prior = byId.get(id);

    if (prior) {
      const sourcePatternIds = prior.sourcePatternIds.includes(pattern.patternId)
        ? prior.sourcePatternIds
        : [...prior.sourcePatternIds, pattern.patternId];
      byId.set(id, {
        ...prior,
        kind: pattern.kind,
        patternId: pattern.patternId,
        message: prior.message,
        sourcePatternIds,
        hits: pattern.frequency,
        updatedAt: now,
      });
    } else {
      byId.set(id, {
        id,
        kind: pattern.kind,
        patternId: pattern.patternId,
        message: pattern.recommendation,
        sourcePatternIds: [pattern.patternId],
        serves: 0,
        hits: pattern.frequency,
        acceptanceRate: 0,
        status: 'needs_review',
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return [...byId.values()].sort((a, b) => {
    if (b.hits !== a.hits) {
      return b.hits - a.hits;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
