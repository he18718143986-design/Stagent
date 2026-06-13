import { PRIMARY_DECISION_OUTPUT_KEY } from '../../WorkflowOutputKeys';
import { isLlmTextTool } from '../../workflow/StageToolKinds';
import { implHasDecisionRecordSourceStrict } from '../../workflow/StageInputSources';
import { rule20Msg } from '../../l10n/rule20Msg';
import { promptIncludesDecisionConstraint } from '../decisionConstraint';
import type { VerifyContext } from '../verify-context';

export function applyImplInputConstraintPairingRules(ctx: VerifyContext): void {
  const { implStages, violations } = ctx;

  for (const impl of implStages) {
    if (implHasDecisionRecordSourceStrict(impl.input.sources)) {
      continue;
    }
    if (!isLlmTextTool(impl.tool)) {
      continue;
    }
    violations.push({
      type: 'missing-decisionRecord-source',
      stageId: impl.id,
      message: rule20Msg('missing-decisionRecord-source'),
    });
  }

  for (const impl of implStages) {
    if (!isLlmTextTool(impl.tool)) {
      continue;
    }
    const prompt = String((impl.toolConfig as { systemPrompt?: unknown })?.systemPrompt ?? '');
    if (!promptIncludesDecisionConstraint(prompt)) {
      violations.push({
        type: 'missing-constraint-prompt',
        stageId: impl.id,
        message: rule20Msg('missing-constraint-prompt'),
      });
    }
  }
}
