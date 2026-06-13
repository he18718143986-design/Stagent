import {
  decideStageIdFromSemanticName,
  semanticNameFromImplStageId,
} from '../../workflow/StageIdPatterns';
import { rule20Msg } from '../../l10n/rule20Msg';
import type { VerifyContext } from '../verify-context';
import {
  forStagesWithSemanticName,
  pushPairingViolation,
  pushPairingWarning,
} from './pairingHelpers';

export function applyImplMissingDecidePairingRules(ctx: VerifyContext): void {
  const { implStages, decideStages, isDecisionBacked } = ctx;

  forStagesWithSemanticName(implStages, semanticNameFromImplStageId, (impl, semanticName) => {
    const pairedDecide = decideStages.find((d) => d.id === decideStageIdFromSemanticName(semanticName));
    if (pairedDecide) {
      return;
    }
    if (impl.exposeAssumptions) {
      pushPairingWarning(ctx, {
        type: 'exposeAssumptions-exemption',
        stageId: impl.id,
        message: rule20Msg('exposeAssumptions-exemption'),
      });
    } else if (isDecisionBacked(impl)) {
      pushPairingWarning(ctx, {
        type: 'impl-decision-not-paired',
        stageId: impl.id,
        message: rule20Msg('impl-decision-not-paired'),
      });
    } else {
      pushPairingViolation(ctx, {
        type: 'missing-decision-stage',
        stageId: impl.id,
        message: rule20Msg('missing-decision-stage'),
      });
    }
  });
}
