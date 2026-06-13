import type { WorkflowGlobalConfig } from './WorkflowDefinition';

/** M20.2.2：未显式关闭时默认开启决策内容 HARD 校验（I-17 ~ I-19） */
export function isDecisionContentLintEnabled(
  globalConfig: WorkflowGlobalConfig | undefined,
  vscodeDefault = true,
): boolean {
  if (globalConfig?.enableDecisionContentLint === false) {
    return false;
  }
  return vscodeDefault;
}