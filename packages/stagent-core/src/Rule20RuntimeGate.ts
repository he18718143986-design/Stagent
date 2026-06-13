/**
 * Rule20RuntimeGate
 * -----------------
 * M14.4 落地 SPEC §9.1 I-23：把"只在 CI 跑"的 `verifyRule20` 接入
 * `WorkflowEngine.generateWorkflow` 运行时。
 *
 * 设计要点：
 *  - **灰度开关（v2.8.1 default ON）**：由 vscode 配置 `stagent.enableRuntimeRule20Verify` 控制，
 *    显式 `false` → 与 v2.7 行为完全等价（不调用 verifyRule20，仅保留 `stage_count_near_limit`）。
 *  - **M20.2.1 阻断**：violations 非空时 `generateWorkflow` 推 `workflowFailed`（不再进入确认页）。
 *  - **灰度开关（v2.8.1 default ON）**：显式 `false` → 与 v2.7 行为完全等价（不调用 verifyRule20）。
 *  - **warnings 通道**：Rule20Verify warnings 与 `stage_count_near_limit` 仍落入 `workflowGenerated.warnings`。
 *    `rule20:<type>:<stageId>`        ← Rule20Verify violations（HARD 违反）
 *    `rule20-soft:<type>:<stageId>`   ← Rule20Verify warnings（SOFT 提示）
 *    `stage_count_near_limit`          ← 既有 stage 数量提醒（向后兼容）
 *
 *    刻意**不**把 `VerifyIssue.message` 拼进字符串：消息通常含中文与特殊字符，
 *    会让 `WebviewPanel` 的 `warnings.join(', ')` 变成一长串难读文本；
 *    需要看完整诊断时跑 `npm run verify:rule20` 即可（与 CI 同源）。
 *  - **纯函数**：完全不依赖 vscode / fs，便于单测；运行时由 WorkflowEngine 读 vscode
 *    配置后传入 `enableRuntimeRule20Verify` 布尔值。
 */

import type { VerifyIssue, VerifyResult } from './Rule20Verify';

export type Rule20WarningKind = 'violation' | 'warning';

/** 把单条 VerifyIssue 序列化为 workflowGenerated.warnings 中的字符串行 */
export function formatRule20IssueLine(issue: VerifyIssue, kind: Rule20WarningKind): string {
  const prefix = kind === 'violation' ? 'rule20' : 'rule20-soft';
  const stageId = typeof issue.stageId === 'string' && issue.stageId.length > 0 ? issue.stageId : 'workflow';
  const type = typeof issue.type === 'string' && issue.type.length > 0 ? issue.type : 'unknown';
  return `${prefix}:${type}:${stageId}`;
}

export interface BuildGeneratorWarningsInput {
  /** 工作流阶段数；用于触发既有 `stage_count_near_limit` */
  stageCount: number;
  /** 阶段数预警阈值（WorkflowEngine 内常量 MAX_STAGES_WARN） */
  maxStageWarn: number;
  /** verifyRule20 的结果；可选，不传或开关 OFF 时被忽略 */
  verifyResult?: VerifyResult;
  /** vscode 配置 `stagent.enableRuntimeRule20Verify`；v2.8.1 默认 true，显式 false 关闭 */
  enableRuntimeRule20Verify: boolean;
}

/**
 * 组装 `workflowGenerated.warnings` 数组。组装顺序：
 *   1. 既有 `stage_count_near_limit`（保持 v2.6+ 行为）
 *   2. 当 `enableRuntimeRule20Verify=true` 且 `verifyResult` 提供时：
 *      a. violations → `rule20:...`
 *      b. warnings  → `rule20-soft:...`
 *
 * 当开关 OFF 或 `verifyResult` 未提供时，**完全跳过** rule20 序列化——
 * 这是回滚保障，确保关闭开关的行为与 v2.7 完全等价（含字节级一致）。
 */
export function buildGeneratorWarnings(input: BuildGeneratorWarningsInput): string[] {
  const warnings: string[] = [];

  if (input.stageCount > input.maxStageWarn) {
    warnings.push('stage_count_near_limit');
  }

  if (input.enableRuntimeRule20Verify && input.verifyResult) {
    for (const v of input.verifyResult.violations) {
      warnings.push(formatRule20IssueLine(v, 'violation'));
    }
    for (const w of input.verifyResult.warnings) {
      warnings.push(formatRule20IssueLine(w, 'warning'));
    }
  }

  return warnings;
}
