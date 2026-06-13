import type { Stage } from './StageTypes';

// ─── WorkflowDefinition ────────────────────────────────────────
export interface WorkflowMeta {
  title: string;
  taskType: string; // software / video / document / debug / ...
  userInput: string;
  createdAt: string;
  /** true = 全新项目（绿场），豁免 Rule 20-G zoom-out；见 SPEC-v2 Rule 20-G / §11 */
  isGreenfield?: boolean;
  /**
   * 用户指定的任务工作区根目录（绝对路径）。生成工作流时由 UI 写入；`code-runner` / `writeOutputToFile` 等落盘相对于
   * `\<该路径>/.stagent/instances/<实例 id>/`。若未设置且未打开 VS Code 工作区，开始执行会失败。
   */
  taskWorkspacePath?: string;
  /**
   * 带 writeOutputToFile 的实现阶段在写入已存在文件时的策略：
   * - 'regenerate'（默认）始终覆盖写入
   * - 'reuse-all' 已存在时跳过写入并复用磁盘内容
   * - 'reuse-partial' 预留给“部分复用+人工确认”场景（当前行为与 'regenerate' 一致）
   */
  reuseStrategy?: 'regenerate' | 'reuse-all' | 'reuse-partial';
  /**
   * 生成前澄清扫描到的工作文件夹已有文件（相对路径，最多约 20 个）。
   * 由 generateClarifyQuestions / generateWorkflow 写入，供审计与 reuse-* 策略参考。
   */
  existingFiles?: string[];
  /**
   * normalize 时由引擎自动插入的全局架构决策阶段 id（`stagent.autoInsertGlobalArchitectureDecision`）。
   * 用于确认页追加 SOFT warning，不代表 LLM 原生生成。
   */
  engineAutoInsertedGlobalArchitectureStageId?: string;
  userInputPolish?: {
    originalDraft: string;
    polishedAt: string;
  };
  /**
   * Path Router 判定的主路径模板（WORKFLOW §4.2：express / greenfield_full / brownfield_full / debug / arch_review）。
   * 生成前由规则层写入；LLM 应在 meta 中回写同一值。
   */
  workflowTemplate?: string;
}

/** 全局决策注入 systemPrompt 时：summary = 每条截断摘要；full = 全文 */
export type GlobalDecisionInjectMode = 'full' | 'summary';

export interface WorkflowGlobalConfig {
  autoAdvance?: boolean;
  /** M12：DAG 调度开关。未设置或 false 为线性执行；true 时按 dependsOn + stage-output 拓扑调度（并行度见 dagMaxParallelism）。 */
  enableDagScheduler?: boolean;
  /** M12.4：DAG 并行度。未设或 1 = 单线程（默认，兼容 M12）；≥2 时每波最多并行该数量的 ready 阶段（决策/pauseAfter/questionBefore 仍串行）。 */
  dagMaxParallelism?: number;
  /**
   * M13.1：决策清单内容级 HARD 校验灰度开关（v2.7 引入）。
   * - 未设或 false：approveDecision 不做内容级校验（仍由 §8.1 UI 质量核查兜底，与 v2.6 行为一致）。
   * - true：approveDecision 触发 DecisionRecordVerify，违反 I-17/I-18/I-19 则推 stageError(invariant-violation) 阻断批准。
   * 对应 SPEC §4.4「升 HARD 入口」与 §9.1 I-17 ~ I-19。
   */
  enableDecisionContentLint?: boolean;
  /**
   * 为 true 时，非决策 llm-text 阶段将已批准 decisionRecord **摘要/全文** 追加到 systemPrompt。
   * 未设时由 vscode `stagent.injectApprovedDecisionContext` 决定（默认 true）。
   */
  injectApprovedDecisionContext?: boolean;
  /** 全局决策注入模式；未设时用 vscode `stagent.globalDecisionInjectMode`（默认 summary） */
  globalDecisionInjectMode?: GlobalDecisionInjectMode;
  language?: string;
  modelOverrides?: {
    decisionStage?: string;
    implStage?: string;
    lightweightStage?: string;
  };
}

export interface WorkflowDefinition {
  id: string;
  version: '2.0';
  meta: WorkflowMeta;
  stages: Stage[];
  globalConfig?: WorkflowGlobalConfig;
}
