/** LLM 调用选项（generation / clarify / repair 等路径共用）。 */
export interface LlmInvokeOpts {
  requireStructured?: boolean;
  jsonMode?: boolean;
  maxTokens?: number;
}

/** workflow-gen 主生成：JSON object 模式 + 结构化模型优选。 */
export function workflowGenLlmInvokeOpts(maxTokens: number): LlmInvokeOpts {
  return { requireStructured: true, jsonMode: true, maxTokens };
}

/** workflow-gen-repair：完整 JSON 修复。 */
export function workflowGenRepairLlmInvokeOpts(maxTokens: number): LlmInvokeOpts {
  return { requireStructured: true, jsonMode: true, maxTokens };
}

/** workflow-gen-continue：续写片段，非完整 JSON object。 */
export function workflowGenContinueLlmInvokeOpts(maxTokens: number): LlmInvokeOpts {
  return { requireStructured: true, maxTokens };
}
