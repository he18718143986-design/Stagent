import { blockIfRule20Violations, reverifyRule20AfterChange } from '../reverifyRule20';
import type { VerifyResult } from '../../Rule20Verify';
import type { GenerationValidationOutcome, PipelineContext } from '../types';

export type Rule20StepResult =
  | GenerationValidationOutcome
  | { verifyResult: VerifyResult | undefined };

export function runRule20Step(ctx: PipelineContext, wf: PipelineContext['wf']): Rule20StepResult {
  const verifyResult = reverifyRule20AfterChange(ctx, wf);
  const blocked = blockIfRule20Violations(ctx, wf, verifyResult, { kind: 'rule20-blocked' });
  if (blocked) {
    return blocked;
  }
  return { verifyResult };
}
