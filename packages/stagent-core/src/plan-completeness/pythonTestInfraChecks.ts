import type { WorkflowDefinition } from '../WorkflowDefinition';
import { isPythonOnlyWorkflow } from '../python-bootstrap/pythonStackDetect';
import { detectPythonInfraPlanIssues } from '../contract-infra';
import type { PlanCompletenessIssue, PlanCompletenessViolationType } from './planCompletenessTypes';

const PLAN_PYTHON_INFRA_KINDS = new Set<PlanCompletenessViolationType>([
  'missing-python-venv-chain',
  'missing-python-test-layout',
  'missing-python-verify-imports',
]);

export function lintPythonTestInfraInPlan(wf: WorkflowDefinition): PlanCompletenessIssue[] {
  if (!isPythonOnlyWorkflow(wf)) {
    return [];
  }
  return detectPythonInfraPlanIssues(wf)
    .filter((issue) => PLAN_PYTHON_INFRA_KINDS.has(issue.kind as PlanCompletenessViolationType))
    .map((issue) => ({
      type: issue.kind as PlanCompletenessViolationType,
      message: issue.message,
    }));
}
