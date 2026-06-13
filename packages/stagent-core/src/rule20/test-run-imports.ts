import { collectWorkflowArtifacts } from '../WorkflowArtifactRegistry';
import { detectPythonImportLintIssues } from '../CodeRunnerImportLint';
import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import { rule20Msg } from '../l10n/rule20Msg';
import type { VerifyContext } from './verify-context';

export function runTestRunImportRules(ctx: VerifyContext): void {
  const { workflow, violations } = ctx;

  for (let si = 0; si < workflow.stages.length; si++) {
    const s = workflow.stages[si];
    if (!isTestRunStageId(s.id) || !isCodeRunnerTool(s.tool)) {
      continue;
    }
    const cmd = String((s.toolConfig as { command?: string }).command ?? '');
    const registry = collectWorkflowArtifacts(workflow);
    for (const issue of detectPythonImportLintIssues(cmd, registry, { stageId: s.id })) {
      violations.push({
        type: 'test-run-imports-missing-artifact',
        stageId: s.id,
        message: rule20Msg('test-run-imports-missing-artifact', issue.message),
      });
    }
  }
}
