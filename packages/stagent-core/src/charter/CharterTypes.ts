/** Charter 规则类型（对齐 WORKFLOW.md §5.5 / STAGENT-PRD §7）。 */
export type CharterRuleType = 'prefer' | 'avoid' | 'acceptable' | 'constraint' | 'escalate';

export interface CharterRule {
  n: number;
  type: CharterRuleType;
  text: string;
  keywords: string[];
}

export interface CharterDocument {
  sourcePath: string;
  prefers: CharterRule[];
  avoids: CharterRule[];
  acceptable: CharterRule[];
  constraints: CharterRule[];
  escalationRules: CharterRule[];
}

/** 决策答案来源（provenance）。 */
export type DecisionProvenance = 'human' | 'charter_direct' | 'charter_inferred' | 'escalated';

/** 三档自动应答模式（STAGENT-PRD §7）。 */
export type CharterAutoAnswerMode = 'off' | 'suggest' | 'auto-with-escalation';

export type CharterMatchKind = 'auto' | 'conflict' | 'uncovered' | 'lowconf';

export interface CharterMatchResult {
  kind: CharterMatchKind;
  provenance: DecisionProvenance;
  matchScore: number;
  conflictScore: number;
  ruleRefs: number[];
  proposal?: string;
  reasoning?: string;
}

export const CHARTER_MATCH_UNCOVERED_THRESHOLD = 0.6;
export const CHARTER_CONFLICT_THRESHOLD = 0.4;
