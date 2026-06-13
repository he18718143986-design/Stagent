import { isTestRunStageId } from '../workflow/StageIdPatterns';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import { rule20Msg } from '../l10n/rule20Msg';
import type { VerifyContext } from './verify-context';

export function runTestRunToolRules(ctx: VerifyContext): void {
  for (const s of ctx.workflow.stages) {
    if (isTestRunStageId(s.id) && !isCodeRunnerTool(s.tool)) {
      ctx.violations.push({
        type: 'test-run-must-use-code-runner',
        stageId: s.id,
        message: rule20Msg('test-run-must-use-code-runner'),
      });
    }
  }
}
