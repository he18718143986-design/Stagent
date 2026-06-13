import type { GenerationValidationOutcome, OrchestratePostParseValidationParams } from './types';
import { buildPipelineContext } from './types';
import { runPrepareStep } from './steps/prepareStep';
import { runRule20Step } from './steps/rule20Step';
import { runPlanCompletenessStep } from './steps/planCompletenessStep';
import { runWarningsStep } from './steps/warningsStep';

export async function runPostParseValidationPipeline(
  params: OrchestratePostParseValidationParams,
): Promise<GenerationValidationOutcome> {
  const ctx = buildPipelineContext(params);

  const prepareResult = runPrepareStep(ctx);
  if ('kind' in prepareResult) {
    return prepareResult;
  }
  let wf = prepareResult.wf;

  const rule20Result = runRule20Step(ctx, wf);
  if ('kind' in rule20Result) {
    return rule20Result;
  }
  let verifyResult = rule20Result.verifyResult;

  const planResult = runPlanCompletenessStep(ctx, wf, verifyResult);
  if ('kind' in planResult) {
    return planResult;
  }
  wf = planResult.wf;
  verifyResult = planResult.verifyResult;

  return await runWarningsStep(ctx, wf, planResult.structuralRepairs, verifyResult);
}
