export type ActionablePatternKind =
  | 'stage-impl-failure'
  | 'decision-retry-heavy'
  | 'code-runner-timeout-cluster'
  | 'low-confidence-cluster'
  | 'high-hitl-burden'
  | 'workflow-abandon'
  | 'test-run-import-missing-artifact';
