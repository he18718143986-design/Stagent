import type { CandidateRule } from './CandidateRuleTypes';

export interface CandidateRuleWarning {
  ruleId: string;
  kind: string;
  message: string;
}

/**
 * 影子 seam：未来接入生效路径的唯一入口。本切片**只产 warning，绝不抛、绝不阻断**。
 *
 * 仅对 status === 'active' 的规则产 warning。若规则携带可选 matcher 正则，则用
 * ctx.text 进行匹配；匹配/正则异常一律吞掉，保证本函数永不 throw、永不 hard-block。
 */
export function evaluateCandidateRulesShadow(
  rules: CandidateRule[],
  ctx: { text?: string },
): CandidateRuleWarning[] {
  const warnings: CandidateRuleWarning[] = [];
  if (!Array.isArray(rules)) {
    return warnings;
  }

  for (const rule of rules) {
    try {
      if (!rule || rule.status !== 'active') {
        continue;
      }
      if (!ruleMatches(rule, ctx.text)) {
        continue;
      }
      warnings.push({ ruleId: rule.id, kind: rule.kind, message: rule.message });
    } catch {
      // 影子 seam 永不因单条规则评估失败而抛出 / 阻断。
    }
  }

  return warnings;
}

/**
 * 可选 matcher：当规则带 `matcher` 字符串时用作正则 test(ctx.text)；否则 active 即匹配。
 * 任何正则编译/匹配异常都视为不匹配（不抛）。
 */
function ruleMatches(rule: CandidateRule, text: string | undefined): boolean {
  const matcher = (rule as { matcher?: unknown }).matcher;
  if (typeof matcher !== 'string' || matcher.length === 0) {
    return true;
  }
  try {
    return new RegExp(matcher).test(text ?? '');
  } catch {
    return false;
  }
}
