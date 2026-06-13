export {
  hasGlobalArchitectureDecisionStage,
  hasGlobalArchitectureDecisionStageHeuristic,
  shouldRequireGlobalArchitectureDecision,
  stageLooksLikeGlobalArchitectureDecision,
} from '../workflow/globalArchitecturePolicy';
export { userHintsMultiModuleOrFullProject } from '../workflow/MultiModuleUserInputHints';

import type { WorkflowDefinition } from '../WorkflowDefinition';
import { isSoftwareTaskType } from '../workflow/TaskType';
import { isImplStageId } from '../workflow/StageIdPatterns';
import { isStagentBundleWriteStage } from '../WorkflowDiskBootstrap';
import {
  hasGlobalArchitectureDecisionStage,
} from '../workflow/globalArchitecturePolicy';
import { userHintsMultiModuleOrFullProject } from '../workflow/MultiModuleUserInputHints';
import { GLOBAL_ARCHITECTURE_IMPL_STAGE_THRESHOLD } from '../workflow/GlobalArchitectureThresholds';

/** Rule20 verify: software-only missing global architecture decision warning trigger. */
export function shouldWarnSoftwareMissingGlobalArchitectureDecision(workflow: WorkflowDefinition): boolean {
  if (!isSoftwareTaskType(workflow.meta?.taskType)) {
    return false;
  }
  if (hasGlobalArchitectureDecisionStage(workflow)) {
    return false;
  }
  const implStages = workflow.stages.filter(
    (s) => isImplStageId(s.id) && !isStagentBundleWriteStage(s),
  );
  const userText = workflow.meta?.userInput ?? '';
  return implStages.length > GLOBAL_ARCHITECTURE_IMPL_STAGE_THRESHOLD || userHintsMultiModuleOrFullProject(userText);
}
