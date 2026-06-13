/** 基础设施链缺口类型（与 PlanCompletenessViolationType 子集对齐）。 */
export type InfraChainIssueKind =
  | 'missing-python-venv-chain'
  | 'missing-python-test-layout'
  | 'missing-python-verify-imports'
  | 'missing-self-heal-npm-install'
  | 'missing-self-heal-verify-imports'
  | 'missing-self-heal-fix';

export interface InfraChainIssue {
  kind: InfraChainIssueKind;
  message: string;
  stageId?: string;
}
