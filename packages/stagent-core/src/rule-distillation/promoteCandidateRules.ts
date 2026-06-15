import type { CandidateRule, CandidateRuleStatus } from './CandidateRuleTypes';

const DEFAULT_BLOCK_MAX_ACCEPTANCE_RATE = 0.3;

export interface PromotionThresholds {
  minServes: number;
  minAcceptanceRate: number;
  /** 验证次数足够但接受率过低 → 判定为噪声并 blocked（默认 0.3） */
  blockMaxAcceptanceRate?: number;
}

function nowOrDefault(now?: () => string): string {
  return (now ?? (() => new Date().toISOString()))();
}

/**
 * 纯函数：依据遥测阈值晋升 / 降级候选规则。
 *
 * - needs_review → active：serves >= minServes && acceptanceRate >= minAcceptanceRate。
 * - needs_review/active → blocked：serves >= minServes &&
 *   acceptanceRate <= (blockMaxAcceptanceRate ?? 0.3)（噪声）。
 * - 其余保持不变；仅变更项更新 updatedAt。
 *
 * blocked 优先于 active：当两者同时满足时（仅在 minAcceptanceRate <= blockMax
 * 这种异常阈值配置下可能发生），按噪声处理为 blocked。
 */
export function promoteCandidateRules(
  rules: CandidateRule[],
  t: PromotionThresholds,
  now?: () => string,
): CandidateRule[] {
  const blockMax = t.blockMaxAcceptanceRate ?? DEFAULT_BLOCK_MAX_ACCEPTANCE_RATE;

  return rules.map((rule) => {
    if (rule.status === 'blocked') {
      return rule;
    }

    const hasServes = rule.serves >= t.minServes;
    let next: CandidateRuleStatus = rule.status;

    if (hasServes && rule.acceptanceRate <= blockMax) {
      next = 'blocked';
    } else if (
      rule.status === 'needs_review' &&
      hasServes &&
      rule.acceptanceRate >= t.minAcceptanceRate
    ) {
      next = 'active';
    }

    if (next === rule.status) {
      return rule;
    }
    return { ...rule, status: next, updatedAt: nowOrDefault(now) };
  });
}

/** 人工激活路径：把指定 id 的规则置为 active。 */
export function markCandidateRuleApproved(
  rules: CandidateRule[],
  id: string,
  now?: () => string,
): CandidateRule[] {
  return rules.map((rule) => {
    if (rule.id !== id || rule.status === 'active') {
      return rule;
    }
    return { ...rule, status: 'active', updatedAt: nowOrDefault(now) };
  });
}
