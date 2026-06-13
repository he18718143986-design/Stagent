import type { WorkflowDefinition } from '../WorkflowDefinition';
import { isWorkflowTemplate, EXPRESS_TEMPLATE_STAGE_SOFT_CAP } from './WorkflowTemplateTypes';

/** prototype / other 单切片阶段硬上限（README P1）。 */
export const PROTOTYPE_OTHER_STAGE_HARD_CAP = 6;

export function resolveWorkflowStageCap(wf: WorkflowDefinition): number | undefined {
  const template = wf.meta?.workflowTemplate;
  if (isWorkflowTemplate(template) && template === 'express') {
    return EXPRESS_TEMPLATE_STAGE_SOFT_CAP;
  }
  const taskType = wf.meta?.taskType?.trim().toLowerCase();
  if (taskType === 'prototype' || taskType === 'other') {
    return PROTOTYPE_OTHER_STAGE_HARD_CAP;
  }
  return undefined;
}

export function lintTemplateStageCap(wf: WorkflowDefinition): string | undefined {
  const cap = resolveWorkflowStageCap(wf);
  if (cap === undefined) {
    return undefined;
  }
  const count = wf.stages?.length ?? 0;
  if (count <= cap) {
    return undefined;
  }
  return `template-stage-cap:${count}>${cap}:${wf.meta?.workflowTemplate ?? wf.meta?.taskType ?? 'unknown'}`;
}
