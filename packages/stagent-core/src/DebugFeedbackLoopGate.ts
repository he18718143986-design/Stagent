import { isDebugTaskType } from './workflow/TaskType';
import { isCodeRunnerTool } from './workflow/StageToolKinds';
import { isImplStageId } from './workflow/StageIdPatterns';
import { debugGateMsg } from './l10n/qualityMsg';
import type { Stage, StageRuntime, WorkflowDefinition } from './WorkflowDefinition';

/**
 * M22-F1（I-26）：debug 工作流在进入 hypothesis / fix impl 前须有可执行反馈回路。
 * 生成期：`stagent.debug.requireFeedbackLoop=hard` 时 Rule20 升 violation；运行期 `hard` 模式 HARD 阻断。
 */

export type DebugFeedbackLoopOutcome = 'pass' | 'block';

export interface DebugFeedbackLoopEvaluation {
  outcome: DebugFeedbackLoopOutcome;
  reason: string;
}

export function isDebugHypothesisOrFixStage(stage: Stage): boolean {
  if ((isImplStageId(stage.id) && stage.id.startsWith('stage_impl_debug_')) || /debug_fix/i.test(stage.id)) {
    return true;
  }
  if (/hypothesis|root_cause/i.test(stage.id)) {
    return true;
  }
  return /假设|根因/.test(stage.title ?? '');
}

export function isExecutableFeedbackStage(stage: Stage): boolean {
  if (isCodeRunnerTool(stage.tool)) {
    return true;
  }
  return /reproduce/i.test(stage.id) || /reproduce/i.test(stage.title ?? '');
}

/** 目标阶段之前是否已有完成的可执行反馈阶段（复现/回归 code-runner）。 */
export function hasCompletedFeedbackLoopBefore(
  definition: WorkflowDefinition,
  stageRuntimes: StageRuntime[],
  targetIndex: number,
): boolean {
  for (let i = 0; i < targetIndex; i += 1) {
    const stage = definition.stages[i];
    const rt = stageRuntimes[i];
    if (!stage || !rt) {
      continue;
    }
    if (rt.status === 'done' && isExecutableFeedbackStage(stage)) {
      return true;
    }
  }
  return false;
}

export function evaluateDebugFeedbackLoopGate(input: {
  workflow: WorkflowDefinition;
  stage: Stage;
  stageIndex: number;
  stageRuntimes: StageRuntime[];
  requireHard: boolean;
}): DebugFeedbackLoopEvaluation | undefined {
  if (!isDebugTaskType(input.workflow.meta?.taskType)) {
    return undefined;
  }
  if (!input.requireHard) {
    return undefined;
  }
  if (!isDebugHypothesisOrFixStage(input.stage)) {
    return undefined;
  }
  if (hasCompletedFeedbackLoopBefore(input.workflow, input.stageRuntimes, input.stageIndex)) {
    return { outcome: 'pass', reason: debugGateMsg('feedbackLoopEstablished') };
  }
  return {
    outcome: 'block',
    reason: debugGateMsg('feedbackLoopRequired'),
  };
}
