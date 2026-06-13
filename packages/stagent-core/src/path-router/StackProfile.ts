import type { WorkflowTemplate } from './WorkflowTemplateTypes';

export const STACK_PROFILES = ['node', 'python', 'auto'] as const;
export type StackProfile = (typeof STACK_PROFILES)[number];

const PYTHON_STACK_HINT_RE = /\b(?:python|pytest|pip\s+install|\.py\b|venv)\b/i;

/** 从用户任务与路径模板推断栈 profile（生成期元数据）。 */
export function resolveStackProfile(
  userInput: string,
  taskType: string,
  workflowTemplate: WorkflowTemplate,
): StackProfile {
  const text = userInput.trim();
  if (!text) {
    return 'auto';
  }
  if (workflowTemplate === 'express' && PYTHON_STACK_HINT_RE.test(text)) {
    return 'python';
  }
  const tt = taskType.trim().toLowerCase();
  if ((tt === 'prototype' || tt === 'other') && PYTHON_STACK_HINT_RE.test(text)) {
    return 'python';
  }
  if (tt === 'software' && PYTHON_STACK_HINT_RE.test(text) && !/\bnpm\b|jest|vitest|typescript\b/i.test(text)) {
    return 'python';
  }
  if (workflowTemplate === 'express') {
    return 'node';
  }
  return 'auto';
}

export function stackProfileLabel(profile: StackProfile): string {
  switch (profile) {
    case 'python':
      return 'Python（pytest/venv）';
    case 'node':
      return 'Node（npm/jest）';
    default:
      return '自动推断';
  }
}
