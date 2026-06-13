import { buildPlanSummary, buildStageSourceSummary } from '../../WorkflowPlanSummary';
import { formatWorkflowGeneratedWarningsForDisplay, summarizeRule20VerifyForLog } from '../../Rule20WarningDisplay';
import { collectDangerousCommandWarningsForWorkflow } from '../../CodeRunnerCommandLint';
import { collectGenerateWarningMessages } from '../collectGenerateWarnings';
import type { VerifyResult } from '../../Rule20Verify';
import type { StructuralRepairAction } from '../../WorkflowStructuralRepair';
import type { GenerationValidationOutcome, PipelineContext } from '../types';
import { DEBUG_EVENT_RULE20_RUNTIME_VERIFY } from '../../DebugLogEvents';
import { WORKFLOW_LEVEL_STAGE_ID } from '../../workflow/WorkflowLevelIds';

export async function runWarningsStep(
  ctx: PipelineContext,
  wf: PipelineContext['wf'],
  structuralRepairs: StructuralRepairAction[],
  verifyResult: VerifyResult | undefined,
): Promise<GenerationValidationOutcome> {
  const warnings = [
    ...(await collectGenerateWarningMessages({
      ...ctx,
      wf,
      structuralRepairs,
      verifyResult,
    })),
    ...collectDangerousCommandWarningsForWorkflow(wf),
  ];

  if (verifyResult) {
    ctx.debugLog(WORKFLOW_LEVEL_STAGE_ID, DEBUG_EVENT_RULE20_RUNTIME_VERIFY, 0, {
      enabled: ctx.runtimeRule20On,
      ...summarizeRule20VerifyForLog(verifyResult),
      warningTokens: warnings,
    });
  }

  return {
    kind: 'success',
    workflow: wf,
    warnings,
    warningsDisplay: formatWorkflowGeneratedWarningsForDisplay(warnings),
    planSummary: buildPlanSummary(wf, { complexity: ctx.complexity, warnings }),
    stageSourceSummary: buildStageSourceSummary(wf),
    structuralRepairs,
    verifyResult,
    runtimeRule20On: ctx.runtimeRule20On,
  };
}
