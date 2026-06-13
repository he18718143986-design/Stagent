import type { StageStatus, WorkflowStatus } from '../workflow-types/RuntimeTypes';

/**
 * 执行循环状态契约（文档 SSOT）。
 *
 * ## 阶段 runtime.status
 *
 * | 状态 | 含义 | 典型入口 |
 * |------|------|----------|
 * | pending | 待执行 | 初始化 / 重试重置 |
 * | running | 执行中 | executeStageStep |
 * | waiting-questions | 等待 questionBefore | WorkflowStageQuestionGate |
 * | paused | 等待 HITL（批准/追问） | notifyStageStatus |
 * | done / skipped | 终态（成功/跳过） | 完成或跳过 |
 * | retrying | 决策重试中 | applyRetryForDecisionCurrent |
 * | error | 阶段失败 | 工具/LLM 错误路径 |
 *
 * ## 实例 instance.status
 *
 * | 状态 | 含义 |
 * |------|------|
 * | idle | 未开始 |
 * | running | 执行中 |
 * | paused | 实例级暂停 |
 * | completed | 全部阶段终态 |
 * | failed | 不可恢复失败（含 I-9 级联重置违反） |
 *
 * ## 执行循环出口（StageStepOutcome / DAG wave）
 *
 * - `continue`：本步/本波次成功，调度器继续。
 * - `exit`：停止循环（halt、failed、或 instance.status === 'failed'）。
 * - `halt`：阶段级暂停（paused / waiting-questions），等待 HITL。
 * - `failed`：阶段或实例失败，不再推进。
 */

export type StageStepOutcome = 'continue' | 'exit' | 'halt' | 'failed';

export type DagWaveLoopOutcome = 'continue' | 'exit';

/** 阶段终态集合（线性跳过 / DAG 完成判定）。 */
export const EXECUTOR_STAGE_TERMINAL_STATUSES: ReadonlySet<StageStatus> = new Set([
  'done',
  'skipped',
]);

/** 阻塞 DAG 调度推进的 HITL 态。 */
export const EXECUTOR_HITL_BLOCKING_STAGE_STATUSES: ReadonlySet<StageStatus> = new Set([
  'paused',
  'waiting-questions',
]);

/** 实例级失败出口原因（日志 / 测试断言）。 */
export const EXECUTOR_INSTANCE_FAIL_REASONS = {
  I9_CASCADE_RESET: 'hitl-retry-i9-cascade-reset-failed',
  STAGE_STEP_FAILED: 'stage-step-failed',
  DAG_WAVE_FAILED: 'dag-wave-stage-failed',
  SANDBOX_UNENFORCED: 'sandbox-enforcement-unavailable',
  GENERATION_SUPERSEDED: 'generation-superseded-swallow',
} as const;

export type ExecutorInstanceFailReason =
  (typeof EXECUTOR_INSTANCE_FAIL_REASONS)[keyof typeof EXECUTOR_INSTANCE_FAIL_REASONS];

/** 合法实例 status 终态（失败或完成）。 */
export const EXECUTOR_INSTANCE_TERMINAL_STATUSES: ReadonlySet<WorkflowStatus> = new Set([
  'completed',
  'failed',
]);
