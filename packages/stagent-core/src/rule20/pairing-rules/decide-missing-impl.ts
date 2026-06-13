import {
  implStageIdFromSemanticName,
  semanticNameFromDecideStageId,
} from '../../workflow/StageIdPatterns';
import { hasStageOutputSource } from '../../workflow/StageInputSources';
import { rule20Msg } from '../../l10n/rule20Msg';
import type { VerifyContext } from '../verify-context';
import {
  forStagesWithSemanticName,
  pushPairingViolation,
  pushPairingWarning,
} from './pairingHelpers';

export function applyDecideMissingImplPairingRules(ctx: VerifyContext): void {
  const { workflow, implStages, decideStages } = ctx;

  forStagesWithSemanticName(decideStages, semanticNameFromDecideStageId, (dec, semanticName) => {
    const hasPaired = workflow.stages.some(
      (s) => s.id === implStageIdFromSemanticName(semanticName) || s.id === `stage_${semanticName}`,
    );
    if (hasPaired) {
      return;
    }
    const consumedByImpl = implStages.some((impl) =>
      hasStageOutputSource(impl.input.sources, { stageId: dec.id }),
    );
    if (consumedByImpl) {
      pushPairingWarning(ctx, {
        type: 'decision-not-paired',
        stageId: dec.id,
        message: rule20Msg('decision-not-paired'),
      });
    } else {
      pushPairingViolation(ctx, {
        type: 'broken-naming-pair',
        stageId: dec.id,
        message: rule20Msg('broken-naming-pair'),
      });
    }
  });
}
