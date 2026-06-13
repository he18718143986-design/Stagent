import { planCompletenessMsg } from '../l10n/lintMsg';
import { findLastImplStageIndex, resolveTddSliceBounds } from '../TddSliceScope';
import {
  inferStackFromImplStage,
  inferStackFromTestRunStage,
} from '../TddStackMatch';
import { isImplStageId, isTestRunStageId } from '../workflow/StageIdPatterns';
import { isBundleWriteStageId, isSelfHealStageId } from '../workflow-self-heal/SelfHealStageFactory';
import { isCodeRunnerTool } from '../workflow/StageToolKinds';
import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import type { PlanCompletenessIssue } from './planCompletenessTypes';

function stacksMatch(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}

function implStagesInSlice(stages: readonly Stage[], start: number, end: number, beforeIdx: number): Stage[] {
  const out: Stage[] = [];
  for (let i = start; i < beforeIdx && i < end; i++) {
    const s = stages[i]!;
    if (!isImplStageId(s.id) || isBundleWriteStageId(s.id) || isSelfHealStageId(s.id)) {
      continue;
    }
    out.push(s);
  }
  return out;
}

export function lintUpstreamFixRoutingForTestRun(
  wf: WorkflowDefinition,
  testRunIdx: number,
): PlanCompletenessIssue | null {
  const stage = wf.stages[testRunIdx];
  if (!stage || !isTestRunStageId(stage.id) || !isCodeRunnerTool(stage.tool)) {
    return null;
  }

  const lastImplIdx = findLastImplStageIndex(wf.stages, testRunIdx);
  if (lastImplIdx < 0) {
    return {
      type: 'upstream-fix-no-impl',
      message: planCompletenessMsg('upstream-fix-no-impl', stage.id),
    };
  }

  const targetStack = inferStackFromTestRunStage(stage);
  if (targetStack === null) {
    return null;
  }

  const { start, end } = resolveTddSliceBounds(wf, testRunIdx);
  const impls = implStagesInSlice(wf.stages, start, end, testRunIdx);
  const hasSameStack = impls.some((impl) => stacksMatch(targetStack, inferStackFromImplStage(impl)));

  if (hasSameStack) {
    return null;
  }

  const fallback = wf.stages[lastImplIdx]!;
  const fallbackStack = inferStackFromImplStage(fallback);
  const stackLabel = targetStack === '' ? '(workspace root)' : targetStack;
  const fallbackLabel = fallbackStack === '' ? '(workspace root)' : (fallbackStack ?? '(unknown)');
  return {
    type: 'upstream-fix-stack-routing',
    message: planCompletenessMsg(
      'upstream-fix-stack-routing',
      stage.id,
      stackLabel,
      fallback.id,
      fallbackLabel,
    ),
  };
}

export function lintWorkflowUpstreamFixRouting(wf: WorkflowDefinition): PlanCompletenessIssue[] {
  const issues: PlanCompletenessIssue[] = [];
  for (let i = 0; i < wf.stages.length; i++) {
    const issue = lintUpstreamFixRoutingForTestRun(wf, i);
    if (issue) {
      issues.push(issue);
    }
  }
  return issues;
}
