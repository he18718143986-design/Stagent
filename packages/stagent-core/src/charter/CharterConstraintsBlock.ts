import type { CharterDocument } from './CharterTypes';
import { constraintAndAvoidRules, isCharterEmpty } from './CharterParser';

export const CHARTER_CONSTRAINTS_BLOCK_HEADER = '## 项目决策主旨（Charter 硬约束）';

function formatRuleList(rules: { n: number; text: string }[], label: string): string {
  if (rules.length === 0) {
    return '';
  }
  const lines = rules.map((r) => `- [R#${r.n}] ${r.text}`);
  return `### ${label}\n${lines.join('\n')}`;
}

/**
 * 拼入 llm-text systemPrompt：全量注入 avoid + constraint（与 DecisionRecord 注入块并存）。
 * 对齐 STAGENT-PRD §7：constraint 类规则每次 bundle 全量注入。
 */
export function buildCharterConstraintsBlock(doc: CharterDocument | null | undefined): string | null {
  if (!doc || isCharterEmpty(doc)) {
    return null;
  }
  const avoidBlock = formatRuleList(doc.avoids, '避免（Avoid）— 默认排除');
  const constraintBlock = formatRuleList(doc.constraints, '约束（Constraints）— 硬性边界，越界必须升级');
  const parts = [CHARTER_CONSTRAINTS_BLOCK_HEADER, avoidBlock, constraintBlock].filter(Boolean);
  if (parts.length <= 1) {
    return null;
  }
  return parts.join('\n\n');
}

export function appendCharterConstraintsToSystemPrompt(
  systemPrompt: string,
  block: string | null | undefined,
): string {
  if (!block?.trim()) {
    return systemPrompt;
  }
  return `${systemPrompt.trimEnd()}\n\n---\n\n${block.trim()}`;
}

/** 运行期 lint：impl 输出是否疑似越过 constraint/avoid（轻量关键词命中）。 */
export function lintCharterConstraintHits(
  doc: CharterDocument,
  outputText: string,
): { hit: boolean; ruleRefs: number[]; messages: string[] } {
  const lower = outputText.toLowerCase();
  const hits: number[] = [];
  const messages: string[] = [];
  for (const rule of constraintAndAvoidRules(doc)) {
    const matched = rule.keywords.some((k) => k.length >= 3 && lower.includes(k));
    if (matched) {
      hits.push(rule.n);
      messages.push(`疑似触及 Charter [R#${rule.n}]（${rule.type}）：${rule.text}`);
    }
  }
  return { hit: hits.length > 0, ruleRefs: hits, messages };
}
