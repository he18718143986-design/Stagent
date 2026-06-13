import type { CharterRuleType, DecisionProvenance } from './CharterTypes';

/** Session 结束建议回写 Charter 的单条候选（B-R2γ）。 */
export interface CharterFeedbackCandidate {
  stageId: string;
  stageTitle: string;
  decisionRecord: string;
  provenance: DecisionProvenance;
  suggestedType: CharterRuleType;
  reason: string;
}

export interface CharterFeedbackWriteEntry {
  type: CharterRuleType;
  text: string;
  stageId: string;
  provenance: DecisionProvenance;
}

export interface CharterWriteResult {
  absolutePath: string;
  previousVersion: number;
  nextVersion: number;
  appendedCount: number;
}
