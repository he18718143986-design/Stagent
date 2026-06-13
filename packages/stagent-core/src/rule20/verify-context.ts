import { isDecideStageId, isImplStageId } from '../workflow/StageIdPatterns';
import { isSoftwareTaskType } from '../workflow/TaskType';
import { PRIMARY_DECISION_OUTPUT_KEY } from '../WorkflowOutputKeys';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { isStagentBundleWriteStage } from '../WorkflowDiskBootstrap';
import type { VerifyIssue, VerifyResult, VerifyRule20Options, ViolationType } from './types';
import { rule20Msg, stripRule20WarningSuffix } from '../l10n/rule20Msg';
import { promoteDebugFeedbackWarningsToViolations } from './debug-feedback';
import { WORKFLOW_CONFIG_LEVEL_STAGE_ID } from '../workflow/WorkflowLevelIds';

export interface VerifyContext {
  workflow: WorkflowDefinition;
  options: VerifyRule20Options | undefined;
  violations: VerifyIssue[];
  warnings: VerifyIssue[];
  isSoftware: boolean;
  implStages: Stage[];
  decideStages: Stage[];
  isDecisionBacked: (impl: Stage) => boolean;
}

export function createVerifyContext(
  workflow: WorkflowDefinition,
  options?: VerifyRule20Options,
): VerifyContext {
  const implStages = workflow.stages.filter(
    (s) => isImplStageId(s.id) && !isStagentBundleWriteStage(s),
  );
  const decideStages = workflow.stages.filter((s) => s.isDecisionStage && isDecideStageId(s.id));

  const isDecisionBacked = (impl: Stage): boolean =>
    impl.input.sources.some(
      (src) =>
        src.type === 'stage-output' &&
        src.outputKey === PRIMARY_DECISION_OUTPUT_KEY &&
        isDecideStageId(src.stageId || ''),
    );

  return {
    workflow,
    options,
    violations: [],
    warnings: [],
    isSoftware: isSoftwareTaskType(workflow.meta?.taskType),
    implStages,
    decideStages,
    isDecisionBacked,
  };
}

export function runModelTierDowngradeCheck(ctx: VerifyContext): void {
  if (ctx.workflow.globalConfig?.modelOverrides?.decisionStage) {
    ctx.warnings.push({
      type: 'model-tier-downgrade',
      stageId: WORKFLOW_CONFIG_LEVEL_STAGE_ID,
      message: rule20Msg('model-tier-downgrade'),
    });
  }
}

export function finalizeVerifyResult(ctx: VerifyContext): VerifyResult {
  if (ctx.options?.toIssuesHorizontalLayeringFail) {
    const hi = ctx.warnings.findIndex((w) => w.type === 'to-issues-horizontal-layering');
    if (hi >= 0) {
      const promoted = ctx.warnings.splice(hi, 1)[0];
      ctx.violations.push({
        type: 'to-issues-horizontal-layering' as ViolationType,
        stageId: promoted.stageId,
        message: stripRule20WarningSuffix(promoted.message),
      });
    }
  }

  promoteDebugFeedbackWarningsToViolations(
    ctx.warnings,
    ctx.violations,
    ctx.options?.debugFeedbackLoopMode,
  );

  return { passed: ctx.violations.length === 0, violations: ctx.violations, warnings: ctx.warnings };
}
