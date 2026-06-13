/**
 * 有效配置：workflow.globalConfig 显式值 > vscode stagent.* > 调用方传入 default。
 */
import type { GlobalDecisionInjectMode, WorkflowGlobalConfig } from './WorkflowDefinition';
import { resolveDagMaxParallelism } from './WorkflowDag';

export type WorkflowConfigSource = WorkflowGlobalConfig | undefined;

/** 工作流显式 boolean 覆盖 vscode；未设则用 vscode。 */
export function resolveEffectiveBoolean(
  workflowValue: boolean | undefined,
  vscodeValue: boolean,
): boolean {
  return workflowValue ?? vscodeValue;
}

/**
 * 决策内容 lint：工作流 `false` 强制关闭；工作流 `true` 强制开启；未设则用 vscode。
 */
export function resolveEffectiveDecisionContentLint(
  globalConfig: WorkflowConfigSource,
  vscodeDefault: boolean,
): boolean {
  const w = globalConfig?.enableDecisionContentLint;
  if (w === false) {
    return false;
  }
  if (w === true) {
    return true;
  }
  return vscodeDefault;
}

export function resolveEffectiveInjectApprovedDecisionContext(
  globalConfig: WorkflowConfigSource,
  vscodeDefault: boolean,
): boolean {
  return resolveEffectiveBoolean(globalConfig?.injectApprovedDecisionContext, vscodeDefault);
}

export function resolveEffectiveGlobalDecisionInjectMode(
  globalConfig: WorkflowConfigSource,
  vscodeDefault: GlobalDecisionInjectMode,
): GlobalDecisionInjectMode {
  return globalConfig?.globalDecisionInjectMode ?? vscodeDefault;
}

export function resolveEffectiveDagMaxParallelism(
  globalConfig: WorkflowConfigSource,
  vscodeDefault: number,
): number {
  return resolveDagMaxParallelism(globalConfig?.dagMaxParallelism, vscodeDefault);
}

export function resolveEffectiveEnableDagScheduler(globalConfig: WorkflowConfigSource): boolean {
  return globalConfig?.enableDagScheduler === true;
}
