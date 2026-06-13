import type { WorkflowDefinition } from '../WorkflowDefinition';
import { isHorizontalTddPlan } from '../RedGreenGate';
import type { VerifyResult, VerifyRule20Options } from './types';
import { runDagIntegrityRules } from './dag-integrity';
import { runDebugTaskRules } from './debug-task-rules';
import { runSoftwareDecisionPairing } from './software-decision-pairing';
import { runTestRunImportRules } from './test-run-imports';
import { runTestRunToolRules } from './test-run-tool-rules';
import {
  runImproveArchitectureTaskRules,
  runPrototypeTaskRules,
  runRefactorTaskRules,
} from './task-type-verification';
import { runToIssuesRules } from './to-issues';
import { rule20Msg } from '../l10n/rule20Msg';
import {
  createVerifyContext,
  finalizeVerifyResult,
  runModelTierDowngradeCheck,
} from './verify-context';
import { WORKFLOW_LEVEL_STAGE_ID } from '../workflow/WorkflowLevelIds';

export function verifyRule20(workflow: WorkflowDefinition, options?: VerifyRule20Options): VerifyResult {
  const ctx = createVerifyContext(workflow, options);

  runModelTierDowngradeCheck(ctx);
  runSoftwareDecisionPairing(ctx);
  runTestRunToolRules(ctx);
  runToIssuesRules(ctx);
  runDebugTaskRules(ctx);
  runTestRunImportRules(ctx);
  runPrototypeTaskRules(ctx);
  runRefactorTaskRules(ctx);
  runDagIntegrityRules(ctx);
  runImproveArchitectureTaskRules(ctx);

  if (isHorizontalTddPlan(workflow.stages ?? [])) {
    ctx.warnings.push({
      type: 'horizontal-tdd',
      stageId: WORKFLOW_LEVEL_STAGE_ID,
      message: rule20Msg('horizontal-tdd'),
    });
  }

  return finalizeVerifyResult(ctx);
}
