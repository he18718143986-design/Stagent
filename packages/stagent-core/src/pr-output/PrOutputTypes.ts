/**
 * PR/CI-ready 输出生成器的输入类型（安全首切片）。
 *
 * 这些类型刻意**与 `WorkflowInstance` 解耦**：生成器是纯函数，仅消费结构化输入，
 * 不依赖引擎运行时状态，便于隔离与单测。后续切片再在交付收口
 * （`deliveryWrapupStage` 等）把 WorkflowInstance 映射到这些输入并接线。
 *
 * 本切片**不接入任何生效路径**（dead-code-safe）。
 */

export interface PrDescriptionInput {
  /** PR 标题。缺省时生成器使用占位标题。 */
  title?: string;
  /** 任务目标，来自 `TaskBrief.goal`。 */
  taskGoal?: string;
  /** 完成标准 / DoD，来自 `TaskBrief.acceptance`。 */
  acceptance?: string[];
  /** 交付文件清单。 */
  deliverables?: string[];
  /** 变更文件清单。 */
  changedFiles?: string[];
  /** 质量信号（测试通过/失败数、smoke 结果、备注）。 */
  quality?: {
    testsPassed?: number;
    testsFailed?: number;
    smokePassed?: boolean;
    notes?: string[];
  };
  /** 验证证据，如「.venv/bin/python main.py → summary.json: {...} 非平凡」。 */
  verificationEvidence?: string[];
}

export interface ReviewFinding {
  severity: 'info' | 'warn' | 'error';
  message: string;
  location?: string;
}

export interface ReviewSummaryInput {
  findings?: ReviewFinding[];
  quality?: PrDescriptionInput['quality'];
  verificationEvidence?: string[];
}
