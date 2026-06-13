import {
  decideStageIdFromSemanticName,
  implStageIdFromSemanticName,
  isDecideStageId,
  isImplStageId,
  isTestRunStageId,
  isTestWriteStageId,
  semanticNameFromImplStageId,
  testRunStageIdFromSemanticName,
  testWriteStageIdFromSemanticName,
} from '../workflow/StageIdPatterns';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import {
  isMonolithicImplStageId,
  TO_ISSUES_HIGH_HITL_RATIO_THRESHOLD,
} from '../plan-completeness/stageChecks';
import { rule20Msg } from '../l10n/rule20Msg';
import type { VerifyContext } from './verify-context';
import { WORKFLOW_LEVEL_STAGE_ID } from '../workflow/WorkflowLevelIds';

export function runToIssuesRules(ctx: VerifyContext): void {
  const { workflow, isSoftware, implStages, warnings } = ctx;

  const hasToIssuesShape =
    isSoftware &&
    implStages.length > 0 &&
    workflow.stages.some((s) => isTestWriteStageId(s.id) || isTestRunStageId(s.id));
  if (!hasToIssuesShape) {
    return;
  }

  const decideSet = new Set(workflow.stages.filter((s) => isDecideStageId(s.id)).map((s) => s.id));
  const writeSet = new Set(workflow.stages.filter((s) => isTestWriteStageId(s.id)).map((s) => s.id));
  const runSet = new Set(workflow.stages.filter((s) => isTestRunStageId(s.id)).map((s) => s.id));

  const decideIndices = workflow.stages
    .map((s, i) => (isDecideStageId(s.id) ? i : -1))
    .filter((i) => i >= 0);
  const implIndices = workflow.stages
    .map((s, i) => (isImplStageId(s.id) ? i : -1))
    .filter((i) => i >= 0);
  if (decideIndices.length >= 2 && implIndices.length >= 1) {
    const lastDecide = Math.max(...decideIndices);
    const firstImpl = Math.min(...implIndices);
    if (firstImpl > lastDecide) {
      warnings.push({
        type: 'to-issues-horizontal-layering',
        stageId: WORKFLOW_LEVEL_STAGE_ID,
        message: rule20Msg('to-issues-horizontal-layering'),
      });
    }
  }

  for (const impl of implStages) {
    const semantic = semanticNameFromImplStageId(impl.id);
    if (!semantic) {
      continue;
    }
    const hasChain =
      decideSet.has(decideStageIdFromSemanticName(semantic)) &&
      writeSet.has(testWriteStageIdFromSemanticName(semantic)) &&
      runSet.has(testRunStageIdFromSemanticName(semantic));
    if (!hasChain) {
      warnings.push({
        type: 'to-issues-missing-chain',
        stageId: impl.id,
        message: rule20Msg('to-issues-missing-chain'),
      });
    }

    const hasVerification =
      runSet.has(testRunStageIdFromSemanticName(semantic)) ||
      workflow.stages.some((s) => isCodeRunnerTool(s.tool) && new RegExp(semantic, 'i').test(s.id));
    if (!hasVerification) {
      warnings.push({
        type: 'to-issues-missing-verification',
        stageId: impl.id,
        message: rule20Msg('to-issues-missing-verification'),
      });
    }

    if (isMonolithicImplStageId(impl.id)) {
      warnings.push({
        type: 'to-issues-monolithic-impl-naming',
        stageId: impl.id,
        message: rule20Msg('to-issues-monolithic-impl-naming'),
      });
    }
  }

  const pauseCount = workflow.stages.filter((s) => s.pauseAfter).length;
  const hitlRatio = workflow.stages.length > 0 ? pauseCount / workflow.stages.length : 0;
  if (hitlRatio > TO_ISSUES_HIGH_HITL_RATIO_THRESHOLD) {
    warnings.push({
      type: 'to-issues-high-hitl-ratio',
      stageId: WORKFLOW_LEVEL_STAGE_ID,
      message: rule20Msg('to-issues-high-hitl-ratio', hitlRatio.toFixed(2)),
    });
  }
}
