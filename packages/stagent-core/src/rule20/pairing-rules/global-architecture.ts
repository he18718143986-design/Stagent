import { rule20Msg } from '../../l10n/rule20Msg';
import { shouldWarnSoftwareMissingGlobalArchitectureDecision } from '../architecture';
import type { VerifyContext } from '../verify-context';
import { WORKFLOW_LEVEL_STAGE_ID } from '../../workflow/WorkflowLevelIds';

export function applyGlobalArchitecturePairingRule(ctx: VerifyContext): void {
  if (!shouldWarnSoftwareMissingGlobalArchitectureDecision(ctx.workflow)) {
    return;
  }
  ctx.warnings.push({
    type: 'software-missing-global-architecture-decision',
    stageId: WORKFLOW_LEVEL_STAGE_ID,
    message: rule20Msg('software-missing-global-architecture-decision'),
  });
}
