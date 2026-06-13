import type { WorkflowDefinition } from '../WorkflowDefinition';
import { detectMultiModuleLayout } from '../path-router/multiModuleLayoutDetect';
import { isWorkflowTemplate } from '../path-router/WorkflowTemplateTypes';
import { isImplStageId } from '../workflow/StageIdPatterns';
import type { PlanCompletenessIssue } from './planCompletenessTypes';

export const MULTI_MODULE_MIN_IMPL_SLICES = 4;

export function lintExpressIncompatibleModuleLayout(
  wf: WorkflowDefinition,
): PlanCompletenessIssue | undefined {
  if (!detectMultiModuleLayout({
    taskType: wf.meta?.taskType,
    userInput: wf.meta?.userInput,
  })) {
    return undefined;
  }
  const template = wf.meta?.workflowTemplate;
  if (!isWorkflowTemplate(template) || template !== 'express') {
    return undefined;
  }
  return {
    type: 'express-incompatible-module-layout',
    message:
      'software 需求含 ≥4 个模块路径 token（multiModuleLayout），不可使用 express 模板；须 greenfield_full 多垂直切片。',
  };
}

/** multiModuleLayout 命中时须 ≥4 个 stage_impl_* 垂直切片。 */
export function lintMultiModuleSliceCoverage(
  wf: WorkflowDefinition,
): PlanCompletenessIssue | undefined {
  if (
    !detectMultiModuleLayout({
      taskType: wf.meta?.taskType,
      userInput: wf.meta?.userInput,
    })
  ) {
    return undefined;
  }
  const implStages = wf.stages.filter((s) => isImplStageId(s.id));
  if (implStages.length >= MULTI_MODULE_MIN_IMPL_SLICES) {
    return undefined;
  }
  return {
    type: 'multi-module-insufficient-slices',
    message: `multiModuleLayout 须至少 ${MULTI_MODULE_MIN_IMPL_SLICES} 个 stage_impl_* 垂直切片（当前 ${implStages.length}）`,
  };
}
