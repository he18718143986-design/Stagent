import { findStageIdsUnreachableFromFirstStage, formatWorkflowDependencyCycleError } from '../WorkflowDag';
import { resolveEffectiveEnableDagScheduler } from '../EffectiveSettings';
import { DAG_UNREACHABLE_STAGES_DISPLAY_MAX } from '../UiListLimits';
import { rule20Msg } from '../l10n/rule20Msg';
import type { VerifyContext } from './verify-context';
import { WORKFLOW_LEVEL_STAGE_ID } from '../workflow/WorkflowLevelIds';

export function runDagIntegrityRules(ctx: VerifyContext): void {
  const { workflow, warnings } = ctx;

  if (!resolveEffectiveEnableDagScheduler(workflow.globalConfig) || !workflow.stages?.length) {
    return;
  }

  const cycleHint = formatWorkflowDependencyCycleError(workflow.stages);
  if (cycleHint) {
    warnings.push({
      type: 'dag-dependency-cycle-hint',
      stageId: WORKFLOW_LEVEL_STAGE_ID,
      message: rule20Msg('dag-dependency-cycle-hint', cycleHint),
    });
    return;
  }

  const unreachable = findStageIdsUnreachableFromFirstStage(workflow.stages);
  if (unreachable.length > 0) {
    warnings.push({
      type: 'dag-unreachable-from-entry',
      stageId: WORKFLOW_LEVEL_STAGE_ID,
      message: rule20Msg(
        'dag-unreachable-from-entry',
        unreachable.slice(0, DAG_UNREACHABLE_STAGES_DISPLAY_MAX).join(', '),
        unreachable.length > DAG_UNREACHABLE_STAGES_DISPLAY_MAX ? '…' : '',
      ),
    });
  }
}
