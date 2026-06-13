import type { CharterMatchKind, DecisionProvenance } from '../charter/CharterTypes';

/** 确认页决策板单条（对齐 B-ROUTE §11.3）。 */
export interface DecisionBoardItem {
  stageId: string;
  stageTitle: string;
  kind: CharterMatchKind;
  provenance: DecisionProvenance;
  matchScore: number;
  conflictScore: number;
  ruleRefs: number[];
  proposal?: string;
  reasoning?: string;
  /** conflict / uncovered / lowconf 须用户在确认页处理 */
  requiresUser: boolean;
  /** B-R3：白话一句话摘要 */
  plainSummary?: string;
}

export interface DecisionBoardSummary {
  total: number;
  auto: number;
  needsReview: number;
}

export interface DecisionBoardPayload {
  items: DecisionBoardItem[];
  summary: DecisionBoardSummary;
}

/** 用户于确认页批准（或默认采纳 auto 项）后随 startExecution 回传。 */
export interface FrontloadDecisionResolution {
  stageId: string;
  decisionRecord: string;
  provenance: DecisionProvenance;
}

export type DecisionSource = 'inline' | 'frontload';
