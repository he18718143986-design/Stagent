/**
 * 每阶段能力契约模型（安全首切片）。
 *
 * 仅定义类型与纯校验所需的数据结构，**不接入任何执行/生效路径**：
 * 不给 Stage 加字段、不改 WorkflowExecutor、不改 file-write。后续切片再做 wiring。
 *
 * 与 `CodeRunnerCommandLint.detectDangerousShellCommandIssues` 互补：那里是固定灾难
 * 黑名单的硬阻断；这里是更广的"高风险分级 + 需审批"语义。
 */

export interface StageCapabilities {
  /** 相对 workspace 的写入前缀/glob（支持尾部 `**` 与精确匹配）。未设=不限制写入路径。 */
  allowedWritePaths?: string[];
  /** 拒绝写入的前缀/glob；优先于 allowedWritePaths。 */
  deniedWritePaths?: string[];
  /** 命令需匹配任一（子串或简单 glob）；未设=不限制命令。 */
  allowedCommands?: string[];
  /** 网络能力；默认未声明=允许（保守，本切片不据此阻断网络）。 */
  network?: boolean;
  /** 高风险命令是否需审批（默认 true）。 */
  highRiskNeedsApproval?: boolean;
}

export type CapabilityViolationKind =
  | 'write-out-of-scope'
  | 'write-denied'
  | 'command-not-allowed'
  | 'high-risk-command';

export interface CapabilityViolation {
  kind: CapabilityViolationKind;
  detail: string;
}

export interface CapabilityDecision {
  /** 是否允许（无 caps 或未违规=true）。 */
  allowed: boolean;
  /** 是否需 HITL 审批（高风险且 highRiskNeedsApproval）。 */
  requiresApproval: boolean;
  violations: CapabilityViolation[];
}
