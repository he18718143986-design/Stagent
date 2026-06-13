/**
 * `workflowGenerated.warnings` 与确认页解析共用的机器可读 token（Rule20 / 契约 / builtin）。
 * 纯函数，无 vscode 依赖。
 */

import { WORKFLOW_LEVEL_STAGE_ID } from '../workflow/WorkflowLevelIds';

export const RULE20_VIOLATION_PREFIX = 'rule20';
export const RULE20_SOFT_PREFIX = 'rule20-soft';

export const CONTRACT_PREFIX = 'contract';

export const BUILTIN_WARNING_STAGE_COUNT_NEAR_LIMIT = 'stage_count_near_limit';
export const BUILTIN_WARNING_RESTORED_FROM_PERSISTENCE = 'restored_from_persistence';
/**
 * 仅兼容历史 workflowGenerated.warnings 解析；新生成请用 stage_count_near_limit（阈值见 MAX_STAGES_WARN=45）。
 * @deprecated 勿在 prompt / 新生成逻辑中要求模型输出此 token
 */
export const BUILTIN_WARNING_STAGE_COUNT_EXCEEDS_50 = 'stage_count_exceeds_50';

export const PLAN_INCOMPLETE_PREFIX = 'plan_incomplete:';

export const COMPLEXITY_WARNING_PREFIX = 'complexity';
export const COMPLEXITY_EXCEEDS_HARD_CAP = 'exceeds-hard-cap';
export const COMPLEXITY_NEAR_STAGE_LIMIT = 'near-stage-limit';
export const COMPLEXITY_REQUIRES_GLOBAL_ARCHITECTURE_DECISION = 'requires-global-architecture-decision';
export const COMPLEXITY_HIGH_HITL_LIKELY = 'high-hitl-likely';

export function formatComplexityWarningLine(type: string, suffix: string): string {
  return `${COMPLEXITY_WARNING_PREFIX}:${type}:${suffix}`;
}

export type Rule20TokenKind = 'violation' | 'warning';

export type ParsedWorkflowWarning =
  | { kind: 'rule20-violation'; type: string; stageId: string }
  | { kind: 'rule20-soft'; type: string; stageId: string }
  | { kind: 'contract'; type: string; stageId: string }
  | { kind: 'builtin'; type: string };

export function rule20PrefixForKind(kind: Rule20TokenKind): string {
  return kind === 'violation' ? RULE20_VIOLATION_PREFIX : RULE20_SOFT_PREFIX;
}

export function formatRule20TokenLine(
  kind: Rule20TokenKind,
  type: string,
  stageId: string,
): string {
  const prefix = rule20PrefixForKind(kind);
  const sid = stageId.length > 0 ? stageId : WORKFLOW_LEVEL_STAGE_ID;
  const ty = type.length > 0 ? type : 'unknown';
  return `${prefix}:${ty}:${sid}`;
}

export function formatContractWarningColon(
  kind: string,
  subject: string,
  messageSuffix?: string,
): string {
  const base = `${CONTRACT_PREFIX}:${kind}:${subject}`;
  return messageSuffix ? `${base} ${messageSuffix}` : base;
}

export function formatContractWarningAt(kind: string, filePath: string, detail: string): string {
  return `${CONTRACT_PREFIX}:${kind}@${filePath}: ${detail}`;
}

export function formatPlanIncompleteBlockReason(body: string): string {
  return `${PLAN_INCOMPLETE_PREFIX} ${body}`;
}

export function parseWorkflowWarningLine(line: string): ParsedWorkflowWarning | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const violation = new RegExp(`^${RULE20_VIOLATION_PREFIX}:([^:]+):(.+)$`).exec(trimmed);
  if (violation) {
    return { kind: 'rule20-violation', type: violation[1], stageId: violation[2] };
  }
  const soft = new RegExp(`^${RULE20_SOFT_PREFIX}:([^:]+):(.+)$`).exec(trimmed);
  if (soft) {
    return { kind: 'rule20-soft', type: soft[1], stageId: soft[2] };
  }
  const contract = new RegExp(`^${CONTRACT_PREFIX}:([^:]+):(.+)$`).exec(trimmed);
  if (contract) {
    return { kind: 'contract', type: contract[1], stageId: contract[2] };
  }
  return { kind: 'builtin', type: trimmed };
}
