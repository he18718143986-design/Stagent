import type { VerifyContext } from './verify-context';
import { applyImplMissingDecidePairingRules } from './pairing-rules/impl-missing-decide';
import { applyDecideMissingImplPairingRules } from './pairing-rules/decide-missing-impl';
import { applyImplInputConstraintPairingRules } from './pairing-rules/impl-input-constraints';
import { applyGlobalArchitecturePairingRule } from './pairing-rules/global-architecture';

export function runSoftwareDecisionPairing(ctx: VerifyContext): void {
  if (!ctx.isSoftware) {
    return;
  }
  applyImplMissingDecidePairingRules(ctx);
  applyDecideMissingImplPairingRules(ctx);
  applyImplInputConstraintPairingRules(ctx);
  applyGlobalArchitecturePairingRule(ctx);
}
