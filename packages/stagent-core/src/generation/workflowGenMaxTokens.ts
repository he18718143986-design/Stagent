import type { WorkspaceConfiguration } from '../platform/HostTypes';
import { readLlmMaxOutputTokens } from '../settings/readers/llm';

/** greenfield_full 多切片计划单次 JSON 输出下限（低于此易截断）。 */
export const GREENFIELD_FULL_MIN_OUTPUT_TOKENS = 16_384;

/**
 * workflow-gen / continue / repair 共用的 max_tokens。
 * greenfield_full 至少 16384，其余路径用配置值。
 */
export function resolveWorkflowGenMaxOutputTokens(
  cfg?: WorkspaceConfiguration,
  workflowTemplate?: string,
): number {
  const base = readLlmMaxOutputTokens(cfg);
  if (workflowTemplate === 'greenfield_full') {
    return Math.max(base, GREENFIELD_FULL_MIN_OUTPUT_TOKENS);
  }
  return base;
}
