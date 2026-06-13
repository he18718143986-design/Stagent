export type PlanCompletenessViolationType =
  | 'missing-verification-stage'
  | 'missing-test-run-pair'
  | 'missing-main-assembly'
  | 'missing-test-infrastructure'
  | 'test-infra-path-mismatch'
  | 'missing-self-heal-chain'
  | 'multi-file-prompt-mismatch'
  | 'test-stack-nestjs-mismatch'
  | 'upstream-fix-no-impl'
  | 'upstream-fix-stack-routing'
  | 'test-write-import-not-in-plan'
  | 'test-write-import-undeclared'
  | 'missing-python-venv-chain'
  | 'missing-python-test-layout'
  | 'missing-python-verify-imports'
  | 'python-test-import-symbol-missing'
  | 'template-stage-cap-exceeded'
  | 'artifact-graph-unresolved-key'
  | 'thin-llm-system-prompt'
  | 'express-incompatible-module-layout'
  | 'multi-module-insufficient-slices'
  | 'slice-decide-missing-decision-artifacts'
  | 'global-decide-missing-decision-artifacts'
  | 'test-write-missing-module-contract-source'
  | 'impl-missing-module-contract-source';

export interface PlanCompletenessIssue {
  type: PlanCompletenessViolationType;
  message: string;
}
