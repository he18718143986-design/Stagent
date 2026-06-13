import { isSoftwareTaskType } from '../workflow/TaskType';
import type { WorkflowDefinition } from '../WorkflowDefinition';
import type { Rule20StructuralNormalizeOptions } from './types';
import { fixTestRunStagesMustUseCodeRunner } from './steps/test-run-tool';
import { upgradeZoomOutStageToLlmText } from './steps/zoom-out';
import { insertGlobalArchitectureDecisionShellIfNeeded } from './steps/global-architecture';
import {
  ensureAllSoftwareImplConstraintPrompts,
  wireSoftwareImplDecisionSources,
} from './steps/software-impl-wiring';
import {
  ensureAllSoftwareTestWriteContractPrompts,
  wireSoftwareDecisionArtifactsSources,
  wireSoftwareTestWriteDecisionSources,
} from './steps/software-test-write-wiring';

/** verify 前统一入口（WorkflowGeneration.normalizeWorkflow 调用）。 */
export function applyRule20StructuralNormalizations(
  wf: WorkflowDefinition,
  options: Rule20StructuralNormalizeOptions = {},
): void {
  fixTestRunStagesMustUseCodeRunner(wf);
  if (options.upgradeZoomOut === true) {
    upgradeZoomOutStageToLlmText(wf, options.zoomOutGlossaryHint);
  }
  if (isSoftwareTaskType(wf.meta?.taskType)) {
    if (options.autoInsertGlobalArchitectureDecision) {
      insertGlobalArchitectureDecisionShellIfNeeded(wf);
    }
    wireSoftwareImplDecisionSources(wf);
    wireSoftwareTestWriteDecisionSources(wf);
    wireSoftwareDecisionArtifactsSources(wf);
    ensureAllSoftwareImplConstraintPrompts(wf);
    ensureAllSoftwareTestWriteContractPrompts(wf);
  }
}
