/**
 * Re-export shim：非 LLM 工具执行已拆分至 non-llm-runners/*。
 */
export type { NonLlmToolHandler } from './non-llm-runners/registry';
export { executeNonLlmToolFromRegistry } from './non-llm-runners/registry';
