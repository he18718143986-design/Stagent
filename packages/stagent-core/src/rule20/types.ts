export type ViolationType =
  | 'missing-decision-stage'
  | 'broken-naming-pair'
  | 'missing-decisionRecord-source'
  | 'missing-constraint-prompt'
  | 'test-run-must-use-code-runner'
  | 'test-run-imports-missing-artifact'
  | 'to-issues-horizontal-layering'
  | 'debug-feedback-loop-not-first'
  | 'debug-missing-reproduce-stage'
  | 'debug-missing-verification-stage';

export type WarningType =
  | 'exposeAssumptions-exemption'
  | 'model-tier-downgrade'
  | 'prototype-missing-verification-stage'
  | 'prototype-missing-success-criteria'
  | 'prototype-impl-missing-file-read-followup'
  | 'debug-missing-reproduce-stage'
  | 'debug-missing-hypothesis-stage'
  | 'debug-missing-verification-stage'
  | 'debug-impl-missing-decision-source'
  | 'to-issues-missing-chain'
  | 'to-issues-missing-verification'
  | 'to-issues-monolithic-impl-naming'
  | 'to-issues-high-hitl-ratio'
  | 'to-issues-horizontal-layering'
  | 'refactor-missing-decision-stage'
  | 'refactor-missing-verification-stage'
  | 'refactor-monolithic-impl-naming'
  | 'software-missing-global-architecture-decision'
  | 'global-architecture-decision-auto-inserted'
  | 'impl-decision-not-paired'
  | 'decision-not-paired'
  | 'horizontal-tdd'
  | 'debug-feedback-loop-not-first'
  | 'improve-architecture-missing-zoom-out'
  | 'dag-unreachable-from-entry'
  | 'dag-dependency-cycle-hint';

export interface VerifyIssue {
  type: ViolationType | WarningType;
  stageId: string;
  message: string;
}

export interface VerifyResult {
  passed: boolean;
  violations: VerifyIssue[];
  warnings: VerifyIssue[];
}

export interface VerifyRule20Options {
  toIssuesHorizontalLayeringFail?: boolean;
  debugFeedbackLoopMode?: 'off' | 'warn' | 'hard';
}
