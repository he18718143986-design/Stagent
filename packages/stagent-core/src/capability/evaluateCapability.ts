/**
 * 能力契约求值（纯函数，组合 writeScope + commandRisk）。
 *
 * 本切片仅提供决策对象，**不接入执行/生效路径**；由后续切片在执行前调用并据
 * `requiresApproval` 走 HITL、据 `allowed` 决定是否拦截。
 */

import type { CapabilityDecision, CapabilityViolation, StageCapabilities } from './StageCapabilityTypes';
import { checkWritePathAllowed } from './writeScope';
import { classifyCommandRisk } from './commandRisk';

/** 命令匹配 allowedCommands 任一（子串或简单尾部 `*` glob）。 */
function commandMatchesAllowed(command: string, pattern: string): boolean {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return false;
  }
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return command.includes(prefix);
  }
  return command.includes(pattern);
}

export function evaluateWriteCapability(
  caps: StageCapabilities | undefined,
  relPath: string,
): CapabilityDecision {
  const { allowed, violation } = checkWritePathAllowed(caps, relPath);
  const violations: CapabilityViolation[] = violation ? [violation] : [];
  return {
    allowed,
    requiresApproval: false,
    violations,
  };
}

export function evaluateCommandCapability(
  caps: StageCapabilities | undefined,
  command: string,
): CapabilityDecision {
  if (!caps) {
    return { allowed: true, requiresApproval: false, violations: [] };
  }

  const violations: CapabilityViolation[] = [];
  let allowed = true;
  const cmd = typeof command === 'string' ? command : '';

  const allowedCommands = caps.allowedCommands;
  if (allowedCommands && allowedCommands.length > 0) {
    const matched = allowedCommands.some((p) => commandMatchesAllowed(cmd, p));
    if (!matched) {
      violations.push({
        kind: 'command-not-allowed',
        detail: `命令不匹配 allowedCommands ${JSON.stringify(allowedCommands)}：${JSON.stringify(cmd)}`,
      });
      allowed = false;
    }
  }

  const risk = classifyCommandRisk(cmd);
  let requiresApproval = false;
  if (risk.highRisk) {
    violations.push({
      kind: 'high-risk-command',
      detail: `高风险命令（${risk.reasons.join(', ')}）：${JSON.stringify(cmd)}`,
    });
    // 高风险本身不置 allowed=false（交由审批）。
    requiresApproval = caps.highRiskNeedsApproval ?? true;
  }

  return { allowed, requiresApproval, violations };
}
