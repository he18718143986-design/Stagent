import type { CharterDocument, CharterRule } from './CharterTypes';
import { keywordOverlapScore } from './CharterKeywords';

/** Gate 2：越过 Charter constraints[] 边界 → 必须升级（MustEscalateToHuman）。 */
export interface ConstraintBoundaryResult {
  violated: boolean;
  mustEscalate: boolean;
  ruleRefs: number[];
  messages: string[];
}

/** 文本显式声明越过约束边界。 */
const EXPLICIT_BREACH_RE =
  /越过.*约束|违反.*约束|突破.*约束|超出.*约束|不遵守.*约束|无视.*约束/i;

/** 否定措辞 + 约束域关键词 → 疑似越界提案。 */
const NEGATION_RE = /(?:不|勿|禁止|避免|排除|放弃|改为|不用|无需|取消|去掉)/;

/**
 * 约束规则文本 → 越界触发词（确定性 SSOT，仿 InfraStageRegistry）。
 * 键为约束规则关键词子串；值为提案中出现则视为越过该约束边界的词。
 */
const CONSTRAINT_CONTRADICTION_HINTS: ReadonlyArray<{
  constraintHint: RegExp;
  violationTerms: RegExp;
  message: string;
}> = [
  {
    constraintHint: /单进程|无\s*web|无\s*界面/i,
    violationTerms: /微服务|多进程|分布式|web\s*界面|flask|django|fastapi.*ui|前后端分离/i,
    message: '提案与「单进程 / 无 Web 界面」约束冲突',
  },
  {
    constraintHint: /python\s*3\.10/i,
    violationTerms: /python\s*2(?:\.\d+)?|python\s*3\.[0-9]\b(?!0)/i,
    message: '提案与 Python 3.10+ 运行时约束冲突',
  },
  {
    constraintHint: /send_order|orderresult/i,
    violationTerms: /抛异常|raise\s+exception|throws?\s/i,
    message: '提案与返回值错误表达（非抛异常）接口约束冲突',
  },
];

function ruleKeywordHit(text: string, rule: CharterRule): boolean {
  const lower = text.toLowerCase();
  return rule.keywords.some((k) => k.length >= 3 && lower.includes(k.toLowerCase()));
}

function checkNegationAgainstConstraint(text: string, rule: CharterRule): string | undefined {
  if (!NEGATION_RE.test(text) || !ruleKeywordHit(text, rule)) {
    return undefined;
  }
  return `提案否定或放弃约束 [R#${rule.n}]：${rule.text}`;
}

function checkContradictionHints(text: string, rule: CharterRule): string | undefined {
  const blob = `${rule.text}\n${text}`;
  for (const hint of CONSTRAINT_CONTRADICTION_HINTS) {
    if (!hint.constraintHint.test(blob)) {
      continue;
    }
    if (hint.violationTerms.test(text)) {
      return `${hint.message}（约束 [R#${rule.n}]）`;
    }
  }
  return undefined;
}

function checkWeakConstraintTouch(text: string, rule: CharterRule): string | undefined {
  const overlap = keywordOverlapScore(text, rule.keywords);
  if (overlap < 0.35) {
    return undefined;
  }
  if (EXPLICIT_BREACH_RE.test(text)) {
    return `显式声明越过约束 [R#${rule.n}]`;
  }
  return undefined;
}

/**
 * 确定性扫描：提案/问题文本是否越过 Charter constraints[] 边界。
 * 仅 Gate 2；avoid/prefer 由 matchCharterToDecision 的 conflict 路径处理。
 */
export function checkConstraintBoundary(
  doc: CharterDocument,
  text: string,
): ConstraintBoundaryResult {
  const trimmed = text.trim();
  if (!trimmed || doc.constraints.length === 0) {
    return { violated: false, mustEscalate: false, ruleRefs: [], messages: [] };
  }

  const ruleRefs: number[] = [];
  const messages: string[] = [];

  for (const rule of doc.constraints) {
    const checks = [
      checkNegationAgainstConstraint(trimmed, rule),
      checkContradictionHints(trimmed, rule),
      checkWeakConstraintTouch(trimmed, rule),
    ].filter((m): m is string => !!m);

    if (checks.length > 0) {
      ruleRefs.push(rule.n);
      messages.push(...checks);
    }
  }

  const violated = ruleRefs.length > 0;
  return {
    violated,
    mustEscalate: violated,
    ruleRefs: [...new Set(ruleRefs)],
    messages,
  };
}
