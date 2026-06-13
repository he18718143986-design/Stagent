export const TASK_TYPE_SOFTWARE = 'software';
export const TASK_TYPE_PROTOTYPE = 'prototype';
export const TASK_TYPE_DOCUMENT = 'document';
export const TASK_TYPE_DEBUG = 'debug';
export const TASK_TYPE_REFACTOR = 'refactor';
export const TASK_TYPE_IMPROVE_ARCHITECTURE = 'improve-architecture';

export function isSoftwareOrPrototypeTaskType(taskType: string | undefined): boolean {
  return taskType === TASK_TYPE_SOFTWARE || taskType === TASK_TYPE_PROTOTYPE;
}

export function isSoftwareTaskType(taskType: string | undefined): boolean {
  return taskType === TASK_TYPE_SOFTWARE;
}

export function isPrototypeTaskType(taskType: string | undefined): boolean {
  return taskType === TASK_TYPE_PROTOTYPE;
}

export function isDebugTaskType(taskType: string | undefined): boolean {
  return taskType === TASK_TYPE_DEBUG;
}

export function isRefactorTaskType(taskType: string | undefined): boolean {
  return taskType === TASK_TYPE_REFACTOR;
}

export function isImproveArchitectureTaskType(taskType: string | undefined): boolean {
  return taskType === TASK_TYPE_IMPROVE_ARCHITECTURE;
}

export function isDocumentTaskType(taskType: string | undefined): boolean {
  return taskType === TASK_TYPE_DOCUMENT;
}

/** PlanSummary：未指定 taskType 时按 software 处理（与 `!taskType` 语义一致）。 */
export function isSoftwareOrDefaultTaskType(taskType: string | undefined | null): boolean {
  return isSoftwareTaskType(taskType ?? undefined) || !taskType;
}
