import type { Artifact } from '../ArtifactTypes';

export type DecisionProvenance = 'human' | 'charter_direct' | 'charter_inferred' | 'escalated';
import type { WorkflowDefinition } from './WorkflowMetaTypes';

// ─── ErrorType ─────────────────────────────────────────────────
// 与 SPEC-v2 §4.9 一致（含 v2 新增的 code-runner-timeout）
export const ERROR_TYPE_VALUES = [
  'llm-timeout',
  'llm-context-overflow',
  'llm-invalid-output',
  'llm-refusal',
  'llm-quality-below-threshold',
  'tool-execution-failed',
  'code-runner-timeout',
  'file-not-found',
  'stage-not-found',
  'invariant-violation',
  'retry-limit-exceeded',
  'sandbox-network-blocked',
  'sandbox-memory-exceeded',
  'static-analysis-failed',
  'confidence-too-low',
  'unknown',
] as const;

export type ErrorType = (typeof ERROR_TYPE_VALUES)[number];

// ─── StageRuntime ──────────────────────────────────────────────
export const STAGE_STATUS_VALUES = [
  'pending',
  'running',
  'waiting-questions',
  'paused',
  'done',
  'skipped',
  'error',
  'retrying',
] as const;

export type StageStatus = (typeof STAGE_STATUS_VALUES)[number];

/** 阶段失败时持久化的错误摘要，供 resume 重放 stageError / RetryBox。 */
export interface StageRuntimeLastError {
  error: string;
  errorType: ErrorType;
  stdout?: string;
  stderr?: string;
}

/** 智能重试：applyRetryBase 前捕获的失败快照。 */
export interface StageFailureSnapshot {
  capturedAt: string;
  error?: string;
  errorType?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  outputs: Record<string, unknown>;
}

export interface StageRuntime {
  stageId: string;
  status: StageStatus;
  outputs: Record<string, unknown>;
  retryCount: number;
  retryComment?: string;
  questionBeforeAnswers?: Record<string, string>;
  questionAnswers?: Record<string, string>;
  approvedDecisionRecord?: string;
  /** B-R2：决策答案来源（human / charter_direct / charter_inferred / escalated）。 */
  decisionProvenance?: DecisionProvenance;
  /** B-R2：grill questionBefore 逐题 provenance（聚合后写入 decisionProvenance）。 */
  charterQuestionProvenance?: Record<string, DecisionProvenance>;
  /** B-R2：决策批准来源；frontload 表示确认页前置批准。 */
  decisionSource?: 'inline' | 'frontload';
  startedAt?: string;
  completedAt?: string;
  /** 最近一次 stageError 摘要（重启恢复时可重放）。 */
  lastError?: StageRuntimeLastError;
  lastFailureSnapshot?: StageFailureSnapshot;
  /** M23-F1：自适应 grill 轮次（waiting-questions 循环计数）。 */
  grillRound?: number;
  /** M22-F2：本切片红绿门状态（按 semantic 键，避免重复跑配对测试）。 */
  redGreenSlice?: {
    semantic: string;
    phase: 'awaiting-red' | 'red-confirmed' | 'blocked-green';
  };
}

// ─── WorkflowInstance ──────────────────────────────────────────
export const WORKFLOW_STATUS_VALUES = ['idle', 'running', 'paused', 'completed', 'failed'] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUS_VALUES)[number];

export interface WorkflowInstance {
  traceId?: string;
  /**
   * 单调递增的持久化世代号（每次落盘前自增）。
   * 用于 globalState ↔ 磁盘 `.wf-state.json` 双写对账：加载时取较新者，
   * 避免崩溃/写失败窗口内"旧副本覆盖新副本"。缺失视为 0（旧实例兼容）。
   */
  persistRevision?: number;
  /** 最近一次成功落盘时间（ISO）；与 persistRevision 配套用于对账与诊断。 */
  lastSavedAt?: string;
  definition: WorkflowDefinition;
  /**
   * 线性模式：权威执行游标（stages[] 下标）。
   * DAG 模式：UI/HITL 焦点缓存；真实并行/active 集合见 `deriveActiveStageIds` /
   * `describeWorkflowStagePosition`；恢复后须 `syncInstanceStagePosition`。
   * @see docs/dag-scheduling.md
   */
  currentStageIndex: number;
  stageRuntimes: StageRuntime[];
  status: WorkflowStatus;
  taskDir?: string;
  startedAt?: string;
  completedAt?: string;
  /** M15.4：file-write / writeOutputToFile 落盘追踪，用于决策重试磁盘回滚 */
  artifactRegistry?: Artifact[];
}

// ─── PatchInstruction ──────────────────────────────────────────
export interface PatchInstruction {
  search: string;
  replace: string;
  filePath: string;
}
