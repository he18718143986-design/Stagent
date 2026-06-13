import type { Stage, WorkflowDefinition } from '../WorkflowDefinition';
import { isSoftwareOrDefaultTaskType } from './TaskType';
import { isGlobalArchitectureDecideStageId } from './StageIdPatterns';
import { countStagesByKind } from './StageKindCounts';
import { userHintsMultiModuleOrFullProject } from './MultiModuleUserInputHints';
import { GLOBAL_ARCHITECTURE_IMPL_STAGE_THRESHOLD } from './GlobalArchitectureThresholds';

/** Stage id/title heuristic used by confirm-plan summary (broader than strict stage id pattern). */
export function stageLooksLikeGlobalArchitectureDecision(stage: Stage): boolean {
  const id = stage.id.toLowerCase();
  const title = stage.title ?? '';
  return (
    stage.isDecisionStage === true &&
    (/architecture|arch_overview|global|全局|架构/.test(id) ||
      /全局|架构|architecture|overview/.test(title))
  );
}

/** Rule20 / normalize: strict global-architecture decision stage id. */
export function hasGlobalArchitectureDecisionStage(workflow: WorkflowDefinition): boolean {
  return workflow.stages.some(
    (s) => s.isDecisionStage === true && isGlobalArchitectureDecideStageId(s.id),
  );
}

export function hasGlobalArchitectureDecisionStageHeuristic(workflow: WorkflowDefinition): boolean {
  return workflow.stages.some(stageLooksLikeGlobalArchitectureDecision);
}

/** Trigger conditions: software task with impl>5 or multi-module user intent (ignores whether arch stage exists). */
export function shouldRequireGlobalArchitectureDecision(workflow: WorkflowDefinition): boolean {
  if (!isSoftwareOrDefaultTaskType(workflow.meta?.taskType)) {
    return false;
  }
  const { implCount } = countStagesByKind(workflow.stages ?? []);
  const userText = workflow.meta?.userInput ?? '';
  return implCount > GLOBAL_ARCHITECTURE_IMPL_STAGE_THRESHOLD || userHintsMultiModuleOrFullProject(userText);
}
