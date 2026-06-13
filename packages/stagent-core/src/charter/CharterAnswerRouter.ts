import { detectAdrCriteria } from './ADRCriteriaDetector';
import { checkConstraintBoundary } from './ConstraintBoundaryChecker';
import type { CharterDocument, CharterMatchResult, CharterRule } from './CharterTypes';
import {
  CHARTER_CONFLICT_THRESHOLD,
  CHARTER_MATCH_UNCOVERED_THRESHOLD,
} from './CharterTypes';
import { extractKeywords, keywordOverlapScore } from './CharterKeywords';
import { allCharterRules } from './CharterParser';

interface ScoredRule {
  rule: CharterRule;
  score: number;
}

function scoreRulesAgainstQuestion(question: string, rules: CharterRule[]): ScoredRule[] {
  return rules
    .map((rule) => ({ rule, score: keywordOverlapScore(question, rule.keywords) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

function dominantDirection(matches: ScoredRule[]): 'prefer' | 'avoid' | 'mixed' | 'none' {
  const prefer = matches.filter((m) => m.rule.type === 'prefer').length;
  const avoid = matches.filter((m) => m.rule.type === 'avoid').length;
  if (prefer > 0 && avoid > 0) {
    return 'mixed';
  }
  if (prefer > 0) {
    return 'prefer';
  }
  if (avoid > 0) {
    return 'avoid';
  }
  return 'none';
}

function gate1EscalationResult(
  question: string,
  charter: CharterDocument,
  partial: Pick<CharterMatchResult, 'matchScore' | 'conflictScore' | 'ruleRefs' | 'proposal'>,
): CharterMatchResult | null {
  const adr = detectAdrCriteria(question, charter);
  if (!adr.mustEscalate) {
    return null;
  }
  return {
    kind: 'conflict',
    provenance: 'escalated',
    matchScore: partial.matchScore,
    conflictScore: partial.conflictScore,
    ruleRefs: partial.ruleRefs,
    proposal: partial.proposal,
    reasoning: `Gate 1 ADR 判据：${adr.reasons.join('；')}`,
  };
}

function buildProposal(matches: ScoredRule[], direction: string): string {
  const top = matches.slice(0, 2).map((m) => `[R#${m.rule.n}] ${m.rule.text}`);
  if (direction === 'prefer') {
    return `倾向：${top.join('；')}`;
  }
  if (direction === 'avoid') {
    return `排除：${top.join('；')}`;
  }
  return top.join('；');
}

/**
 * 依主旨对决策问题做三闸门判定（对齐 B-ROUTE §11.3 / PRD §6.6）。
 * - matchScore < 0.6 → uncovered（escalated）
 * - conflictScore > 0.4 → conflict（escalated）
 * - 单条高命中 → charter_direct
 * - 弱命中/插值 → charter_inferred
 */
export function matchCharterToDecision(
  question: string,
  charter: CharterDocument,
  confidence = 1,
  confidenceThreshold = 0.4,
): CharterMatchResult {
  const rules = allCharterRules(charter);
  if (rules.length === 0) {
    return {
      kind: 'uncovered',
      provenance: 'escalated',
      matchScore: 0,
      conflictScore: 0,
      ruleRefs: [],
      reasoning: '无 Charter 规则',
    };
  }

  const matches = scoreRulesAgainstQuestion(question, rules);
  const bestScore = matches[0]?.score ?? 0;
  const matchScore = bestScore;

  const preferHits = matches.filter((m) => m.rule.type === 'prefer');
  const avoidHits = matches.filter((m) => m.rule.type === 'avoid');
  const conflictScore =
    preferHits.length > 0 && avoidHits.length > 0
      ? Math.min(
          preferHits.reduce((s, m) => s + m.score, 0) / preferHits.length,
          avoidHits.reduce((s, m) => s + m.score, 0) / avoidHits.length,
        )
      : 0;

  if (matchScore < CHARTER_MATCH_UNCOVERED_THRESHOLD) {
    const gate1 = gate1EscalationResult(question, charter, {
      matchScore,
      conflictScore,
      ruleRefs: [],
    });
    if (gate1) {
      return gate1;
    }
    return {
      kind: 'uncovered',
      provenance: 'escalated',
      matchScore,
      conflictScore,
      ruleRefs: [],
      reasoning: `无足够主旨覆盖（matchScore=${matchScore.toFixed(2)}）`,
    };
  }

  if (conflictScore > CHARTER_CONFLICT_THRESHOLD) {
    return {
      kind: 'conflict',
      provenance: 'escalated',
      matchScore,
      conflictScore,
      ruleRefs: matches.slice(0, 3).map((m) => m.rule.n),
      proposal: buildProposal(matches, 'mixed'),
      reasoning: '命中多条方向冲突的主旨规则',
    };
  }

  if (confidence < confidenceThreshold) {
    const proposal = buildProposal(matches, dominantDirection(matches));
    const boundary = checkConstraintBoundary(charter, `${question}\n${proposal}`);
    if (boundary.mustEscalate) {
      return {
        kind: 'conflict',
        provenance: 'escalated',
        matchScore,
        conflictScore,
        ruleRefs: boundary.ruleRefs,
        proposal,
        reasoning: `Gate 2 约束边界：${boundary.messages[0] ?? '越过 constraints'}`,
      };
    }
    const gate1Low = gate1EscalationResult(question, charter, {
      matchScore,
      conflictScore,
      ruleRefs: matches.slice(0, 2).map((m) => m.rule.n),
      proposal,
    });
    if (gate1Low) {
      return gate1Low;
    }
    return {
      kind: 'lowconf',
      provenance: 'charter_inferred',
      matchScore,
      conflictScore,
      ruleRefs: matches.slice(0, 2).map((m) => m.rule.n),
      proposal,
      reasoning: `置信度 ${confidence.toFixed(2)} 低于阈值 ${confidenceThreshold}`,
    };
  }

  const direction = dominantDirection(matches);
  const isDirect = matches[0]!.score >= 0.75 && (matches.length === 1 || matches[0]!.score - (matches[1]?.score ?? 0) >= 0.25);
  const provenance = isDirect ? 'charter_direct' : 'charter_inferred';
  const kind = provenance === 'charter_direct' ? 'auto' : 'lowconf';
  const proposal = buildProposal(matches, direction);

  const boundary = checkConstraintBoundary(charter, `${question}\n${proposal}`);
  if (boundary.mustEscalate) {
    return {
      kind: 'conflict',
      provenance: 'escalated',
      matchScore,
      conflictScore,
      ruleRefs: boundary.ruleRefs,
      proposal,
      reasoning: `Gate 2 约束边界：${boundary.messages[0] ?? '越过 constraints'}`,
    };
  }

  const gate1 = gate1EscalationResult(question, charter, {
    matchScore,
    conflictScore,
    ruleRefs: matches.slice(0, 2).map((m) => m.rule.n),
    proposal,
  });
  if (gate1) {
    return gate1;
  }

  return {
    kind,
    provenance,
    matchScore,
    conflictScore,
    ruleRefs: matches.slice(0, 2).map((m) => m.rule.n),
    proposal,
    reasoning: isDirect ? '主旨直接命中' : '由主旨插值推导（需抽查）',
  };
}

/**
 * 是否因 Charter provenance 强制 HITL 暂停。
 * - suggest/off：charter_direct / charter_inferred 均须人工确认
 * - auto-with-escalation：代答可放行（里程碑再抽查 inferred）
 */
export function mustPauseForCharterProvenance(
  provenance: string | undefined,
  autoAnswerMode: string,
): boolean {
  if (!provenance || provenance === 'human') {
    return false;
  }
  if (provenance === 'escalated') {
    return true;
  }
  if (autoAnswerMode === 'auto-with-escalation') {
    return false;
  }
  return provenance === 'charter_direct' || provenance === 'charter_inferred';
}
